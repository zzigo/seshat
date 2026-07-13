import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ZoteroProvider, type ZoteroKeyInfo } from '@seshat/zotero';
import { getCatalog } from './catalog';

export type ZoteroSyncMode = 'pull' | 'push' | 'bidirectional';

export interface ZoteroConnectionStatus {
  connected: boolean;
  libraryType?: 'users' | 'groups';
  libraryId?: string;
  username?: string;
  syncMode?: ZoteroSyncMode;
  analyzeAutomatically?: boolean;
  libraryVersion?: number;
  lastSyncedAt?: string;
  lastError?: string;
}

interface ZoteroConnectionSecret extends ZoteroConnectionStatus {
  apiKey: string;
}

const credentialKey = (): Buffer => {
  const secret = String(process.env.ZOTERO_CREDENTIAL_SECRET || process.env.AUTH_SECRET || '').trim();
  if (secret.length < 24) throw new Error('ZOTERO_CREDENTIAL_ENCRYPTION_NOT_CONFIGURED');
  return createHash('sha256').update(`seshat:zotero:v1\0${secret}`).digest();
};

const encryptApiKey = (apiKey: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
};

const decryptApiKey = (encoded: string): string => {
  const [version, iv, tag, encrypted] = encoded.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted) throw new Error('ZOTERO_CREDENTIAL_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8');
};

const statusFromRow = (row: any): ZoteroConnectionStatus => row ? ({
  connected: true,
  libraryType: row.library_type,
  libraryId: String(row.library_id),
  username: String(row.username),
  syncMode: row.sync_mode,
  analyzeAutomatically: Boolean(row.analyze_automatically),
  libraryVersion: row.library_version == null ? undefined : Number(row.library_version),
  lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : undefined,
  lastError: row.last_error || undefined,
}) : { connected: false };

export const getZoteroConnectionStatus = async (ownerKey: string): Promise<ZoteroConnectionStatus> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query('SELECT * FROM catalog_zotero_connections WHERE owner_key=$1', [ownerKey]);
  return statusFromRow(result.rows[0]);
};

export const getZoteroConnection = async (ownerKey: string): Promise<ZoteroConnectionSecret | null> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query('SELECT * FROM catalog_zotero_connections WHERE owner_key=$1', [ownerKey]);
  const row = result.rows[0];
  if (!row) return null;
  return { ...statusFromRow(row), apiKey: decryptApiKey(String(row.api_key_ciphertext)) } as ZoteroConnectionSecret;
};

export const verifyZoteroKey = async (apiKey: string): Promise<ZoteroKeyInfo> => {
  const normalized = apiKey.trim();
  if (!/^[A-Za-z0-9]{16,128}$/.test(normalized)) throw new Error('ZOTERO_API_KEY_INVALID');
  const provider = new ZoteroProvider({ libraryType: 'users', libraryId: 'current', apiKey: normalized });
  const info = await provider.keyInfo();
  if (!info.access?.user?.library) throw new Error('ZOTERO_LIBRARY_ACCESS_REQUIRED');
  return info;
};

export const saveZoteroConnection = async (input: {
  ownerKey: string;
  apiKey: string;
  syncMode: ZoteroSyncMode;
  analyzeAutomatically: boolean;
}): Promise<ZoteroConnectionStatus> => {
  const info = await verifyZoteroKey(input.apiKey);
  if (input.syncMode !== 'pull' && !info.access?.user?.write) throw new Error('ZOTERO_WRITE_ACCESS_REQUIRED');
  const catalog = getCatalog(); await catalog.ensureSchema();
  await catalog.pool.query(
    `INSERT INTO catalog_zotero_connections
      (owner_key,library_type,library_id,username,api_key_ciphertext,sync_mode,analyze_automatically)
     VALUES($1,'users',$2,$3,$4,$5,$6)
     ON CONFLICT(owner_key) DO UPDATE SET
       library_type=excluded.library_type,library_id=excluded.library_id,username=excluded.username,
       api_key_ciphertext=excluded.api_key_ciphertext,sync_mode=excluded.sync_mode,
       analyze_automatically=excluded.analyze_automatically,last_error=NULL,updated_at=now()`,
    [input.ownerKey, String(info.userID), info.username, encryptApiKey(input.apiKey.trim()), input.syncMode, input.analyzeAutomatically],
  );
  return getZoteroConnectionStatus(input.ownerKey);
};

export const deleteZoteroConnection = async (ownerKey: string): Promise<void> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  await catalog.pool.query('DELETE FROM catalog_zotero_connections WHERE owner_key=$1', [ownerKey]);
};

export const updateZoteroConnectionSettings = async (
  ownerKey: string,
  syncMode: ZoteroSyncMode,
  analyzeAutomatically: boolean,
): Promise<ZoteroConnectionStatus> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query(
    `UPDATE catalog_zotero_connections SET sync_mode=$2,analyze_automatically=$3,updated_at=now()
     WHERE owner_key=$1 RETURNING owner_key`,
    [ownerKey, syncMode, analyzeAutomatically],
  );
  if (!result.rows[0]) throw new Error('ZOTERO_NOT_CONNECTED');
  return getZoteroConnectionStatus(ownerKey);
};

export const zoteroProviderFor = async (ownerKey: string): Promise<ZoteroProvider> => {
  const connection = await getZoteroConnection(ownerKey);
  if (!connection?.apiKey || !connection.libraryId || !connection.libraryType) throw new Error('ZOTERO_NOT_CONNECTED');
  return new ZoteroProvider({
    libraryType: connection.libraryType,
    libraryId: connection.libraryId,
    apiKey: connection.apiKey,
  });
};

export const updateZoteroSyncState = async (ownerKey: string, input: { libraryVersion?: number; error?: string | null }): Promise<void> => {
  const catalog = getCatalog(); await catalog.ensureSchema();
  await catalog.pool.query(
    `UPDATE catalog_zotero_connections SET library_version=COALESCE($2,library_version),
       last_synced_at=CASE WHEN $3::text IS NULL THEN now() ELSE last_synced_at END,
       last_error=$3,updated_at=now() WHERE owner_key=$1`,
    [ownerKey, input.libraryVersion ?? null, input.error ?? null],
  );
};
