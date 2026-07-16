import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import { runZoteroSync } from '../../../lib/zotero-sync';

export const POST: APIRoute = async ({ locals }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(identity.email); const catalog = getCatalog();
  try {
    const claimed = await catalog.pool.query(
      `UPDATE catalog_zotero_connections
          SET sync_started_at=now(),last_checked_at=now(),last_error=NULL,updated_at=now()
        WHERE owner_key=$1
          AND (sync_started_at IS NULL OR sync_started_at < now() - interval '1 hour')
      RETURNING owner_key`,
      [ownerKey],
    );
    if (!claimed.rows[0]) {
      const existing = await catalog.pool.query('SELECT sync_started_at FROM catalog_zotero_connections WHERE owner_key=$1', [ownerKey]);
      if (!existing.rows[0]) return Response.json({ error:'ZOTERO_NOT_CONNECTED' }, { status:400 });
      return Response.json({ error:'ZOTERO_SYNC_IN_PROGRESS' }, { status:409 });
    }
    void runZoteroSync(ownerKey).catch((error) => {
      console.error('[seshat:zotero:sync-now]', error instanceof Error ? error.message : error);
    }).finally(() => catalog.pool.query(
      'UPDATE catalog_zotero_connections SET sync_started_at=NULL,updated_at=now() WHERE owner_key=$1',
      [ownerKey],
    ).catch(() => undefined));
    return Response.json({ ok:true, started:true }, { status:202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZOTERO_SYNC_FAILED';
    console.error('[seshat:zotero:sync-now]', message);
    const status = message === 'ZOTERO_SYNC_IN_PROGRESS' ? 409 : message === 'ZOTERO_NOT_CONNECTED' ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
};
