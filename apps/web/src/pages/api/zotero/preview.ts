import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import { previewZoteroSync } from '../../../lib/zotero-sync';

export const GET: APIRoute = async ({ locals }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(identity.email);
  try {
    return Response.json({ ok: true, ...(await previewZoteroSync(ownerKey)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZOTERO_PREVIEW_FAILED';
    console.error('[seshat:zotero:preview]', message);
    return Response.json({ error: message }, { status: 502 });
  }
};
