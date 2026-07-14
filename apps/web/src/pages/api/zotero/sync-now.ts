import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import { runZoteroSync } from '../../../lib/zotero-sync';

export const POST: APIRoute = async ({ locals }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  try {
    return Response.json({ ok: true, ...(await runZoteroSync(ownerKeyFor(identity.email))) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZOTERO_SYNC_FAILED';
    console.error('[seshat:zotero:sync-now]', message);
    const status = message === 'ZOTERO_SYNC_IN_PROGRESS' ? 409 : message === 'ZOTERO_NOT_CONNECTED' ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
};
