import { getCatalog } from './catalog';
import { hasLibraryRoot, storageRootFor, type SeshatUserIdentity } from './bibliography-paths';

export const normalizeWasabiRoot = (value: unknown): string => String(value || '')
  .normalize('NFC')
  .replaceAll('\\', '/')
  .replace(/^s3:\/\/[^/]+\/?/i, '')
  .replace(/^\/+|\/+$/g, '')
  .replace(/\/{2,}/g, '/');

export const validWasabiRoot = (value: string): boolean => Boolean(value)
  && !value.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  && !/[\u0000-\u001f\u007f]/.test(value);

export const allowedWasabiRoot = (identity: SeshatUserIdentity): string => {
  const physical = storageRootFor(identity).root;
  if (!hasLibraryRoot(identity)) return physical;
  return normalizeWasabiRoot(process.env.WASABI_KEY_PREFIX || physical.split('/')[0] || 'zzttuntref');
};

export const assertWasabiRootAllowed = (root: string, identity: SeshatUserIdentity): void => {
  const normalized = normalizeWasabiRoot(root);
  const allowed = allowedWasabiRoot(identity);
  if (!validWasabiRoot(normalized) || (normalized !== allowed && !normalized.startsWith(`${allowed}/`))) {
    throw new Error('INVALID_WASABI_LIBRARY_ROOT');
  }
};

export const getWasabiLibraryRoot = async (ownerKey: string, identity: SeshatUserIdentity): Promise<string> => {
  const fallback = storageRootFor(identity).root;
  const catalog = getCatalog();
  await catalog.ensureSchema();
  const result = await catalog.pool.query(
    'SELECT wasabi_library_root FROM catalog_storage_settings WHERE owner_key=$1',
    [ownerKey],
  );
  const configured = normalizeWasabiRoot(result.rows[0]?.wasabi_library_root);
  if (!configured) return fallback;
  try { assertWasabiRootAllowed(configured, identity); return configured; }
  catch { return fallback; }
};

export const saveWasabiLibraryRoot = async (ownerKey: string, identity: SeshatUserIdentity, value: unknown): Promise<string> => {
  const root = normalizeWasabiRoot(value);
  assertWasabiRootAllowed(root, identity);
  const catalog = getCatalog();
  await catalog.ensureSchema();
  await catalog.pool.query(
    `INSERT INTO catalog_storage_settings(owner_key,wasabi_library_root)
     VALUES($1,$2)
     ON CONFLICT(owner_key) DO UPDATE SET wasabi_library_root=excluded.wasabi_library_root,updated_at=now()`,
    [ownerKey, root],
  );
  return root;
};

export const safeWasabiRelativePath = (value: unknown): string | null => {
  const normalized = normalizeWasabiRoot(value);
  if (!normalized) return '';
  if (!validWasabiRoot(normalized)) return null;
  return normalized;
};

export const wasabiKeyWithinRoot = (key: unknown, root: string): boolean => {
  const normalized = normalizeWasabiRoot(key);
  return validWasabiRoot(normalized)
    && normalized.startsWith(`${normalizeWasabiRoot(root)}/`)
    && !normalized.includes('/.seshat/');
};
