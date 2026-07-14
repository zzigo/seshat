import { getCatalog } from '../apps/web/src/lib/catalog.ts';
import { getZoteroConnectionStatus, zoteroProviderFor } from '../apps/web/src/lib/zotero-connection.ts';
import { pendingInboxZoteroDuplicateMergeCount, runZoteroSync } from '../apps/web/src/lib/zotero-sync.ts';

const catalog = getCatalog();
const pollMs = Math.max(15_000, Number(process.env.ZOTERO_SYNC_POLL_MS || 60_000));

type DueConnection = {
  owner_key: string;
  sync_mode: 'pull' | 'push' | 'bidirectional';
  library_version: string | number | null;
};

const claimDueConnection = async (): Promise<DueConnection | null> => {
  const result = await catalog.pool.query<DueConnection>(`
    WITH candidate AS (
      SELECT owner_key FROM catalog_zotero_connections
      WHERE continuous_sync=true
        AND (sync_started_at IS NULL OR sync_started_at < now() - interval '1 hour')
        AND (last_checked_at IS NULL OR last_checked_at + make_interval(mins => sync_interval_minutes) <= now())
      ORDER BY COALESCE(last_checked_at,created_at)
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE catalog_zotero_connections connection
       SET sync_started_at=now(),last_checked_at=now(),updated_at=now()
      FROM candidate WHERE connection.owner_key=candidate.owner_key
    RETURNING connection.owner_key,connection.sync_mode,connection.library_version`);
  return result.rows[0] || null;
};

const hasLocalChanges = async (connection: DueConnection): Promise<boolean> => {
  if (connection.sync_mode === 'pull') return false;
  const result = await catalog.pool.query(`
    SELECT EXISTS(
      SELECT 1 FROM catalog_zotero_items item
      JOIN catalog_references reference ON reference.id=item.reference_id
      WHERE item.owner_key=$1 AND reference.updated_at > item.synced_at
    ) OR EXISTS(
      SELECT 1 FROM catalog_zotero_collections mapping
      JOIN catalog_libraries library ON library.id=mapping.library_id
      LEFT JOIN catalog_zotero_collections parent ON parent.owner_key=mapping.owner_key AND parent.library_id=library.parent_id
      WHERE mapping.owner_key=$1 AND (library.name<>mapping.name OR parent.zotero_key IS DISTINCT FROM mapping.parent_zotero_key)
    ) AS changed`, [connection.owner_key]);
  return Boolean(result.rows[0]?.changed);
};

const finishCheck = async (ownerKey: string, error?: unknown): Promise<void> => {
  const message = error ? String((error as Error)?.message || error).slice(0, 2000) : null;
  await catalog.pool.query(
    'UPDATE catalog_zotero_connections SET sync_started_at=NULL,last_error=COALESCE($2,last_error),updated_at=now() WHERE owner_key=$1',
    [ownerKey, message],
  );
};

const tick = async (): Promise<void> => {
  const connection = await claimDueConnection();
  if (!connection) return;
  try {
    const status = await getZoteroConnectionStatus(connection.owner_key);
    const provider = await zoteroProviderFor(connection.owner_key);
    const [remote, localChanged, pendingMerges] = await Promise.all([
      provider.libraryChangedSince(Number(status.libraryVersion || 0)),
      hasLocalChanges(connection),
      pendingInboxZoteroDuplicateMergeCount(connection.owner_key),
    ]);
    if (!remote.changed && !localChanged && pendingMerges === 0) {
      await catalog.pool.query(
        'UPDATE catalog_zotero_connections SET sync_started_at=NULL,last_error=NULL,updated_at=now() WHERE owner_key=$1',
        [connection.owner_key],
      );
      console.log(`[seshat:zotero-daemon] checked ${status.username || connection.owner_key} · no changes`);
      return;
    }
    const result = await runZoteroSync(connection.owner_key);
    await finishCheck(connection.owner_key);
    console.log(`[seshat:zotero-daemon] synced ${status.username || connection.owner_key} · pulled=${result.pulled.items} merged=${result.pulled.merged} pushed=${result.pushed.items} conflicts=${result.conflicts.length}`);
  } catch (error) {
    await finishCheck(connection.owner_key, error).catch(() => undefined);
    console.error('[seshat:zotero-daemon]', connection.owner_key, String((error as Error)?.message || error));
  }
};

const loop = async (): Promise<void> => {
  try { await tick(); }
  catch (error) { console.error('[seshat:zotero-daemon:loop]', error); }
  setTimeout(() => void loop(), pollMs);
};

await catalog.ensureSchema();
console.log(`[seshat:zotero-daemon] online poll=${pollMs}ms`);
if (process.env.ZOTERO_SYNC_ONESHOT === 'true') {
  await tick();
  await catalog.pool.end();
} else void loop();
