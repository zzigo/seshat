import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import { runZoteroSync } from '../../../lib/zotero-sync';

export const POST: APIRoute = async ({ request, locals }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null) as { confirmLibraryVersion?: unknown } | null;
  const version = Number(body?.confirmLibraryVersion);
  if (!Number.isFinite(version) || version <= 0) return Response.json({ error: 'preview_required' }, { status: 400 });
  try {
    return Response.json({ ok: true, ...(await runZoteroSync(ownerKeyFor(identity.email), version)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZOTERO_SYNC_FAILED';
    console.error('[seshat:zotero:sync]', message);
    return Response.json({ error: message }, { status: message.startsWith('ZOTERO_PREVIEW_STALE') ? 409 : 502 });
  }
};
