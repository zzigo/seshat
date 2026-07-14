import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import {
  deleteZoteroConnection,
  getZoteroConnectionStatus,
  saveZoteroConnection,
  updateZoteroConnectionSettings,
  type ZoteroSyncMode,
} from '../../../lib/zotero-connection';

const identityFor = (locals: App.Locals) => sessionIdentity((locals as any).session);
const validMode = (value: unknown): value is ZoteroSyncMode => ['pull', 'push', 'bidirectional'].includes(String(value));

export const GET: APIRoute = async ({ locals }) => {
  const identity = identityFor(locals);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  return Response.json(await getZoteroConnectionStatus(ownerKeyFor(identity.email)));
};

export const POST: APIRoute = async ({ request, locals }) => {
  const identity = identityFor(locals);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const syncMode = body?.syncMode;
  if (!validMode(syncMode)) return Response.json({ error: 'invalid_sync_mode' }, { status: 400 });
  const apiKey = String(body?.apiKey || '').trim();
  const analyzeAutomatically = body?.analyzeAutomatically !== false;
  const continuousSync = body?.continuousSync !== false;
  const syncIntervalMinutes = Math.max(5, Math.min(1440, Number(body?.syncIntervalMinutes || 15)));
  const ownerKey = ownerKeyFor(identity.email);
  try {
    const status = apiKey
      ? await saveZoteroConnection({ ownerKey, apiKey, syncMode, analyzeAutomatically, continuousSync, syncIntervalMinutes })
      : await updateZoteroConnectionSettings(ownerKey, syncMode, analyzeAutomatically, continuousSync, syncIntervalMinutes);
    return Response.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ZOTERO_CONNECTION_FAILED';
    const status = /INVALID|ACCESS|NOT_CONNECTED/.test(message) ? 400 : 502;
    console.error('[seshat:zotero:connection]', message);
    return Response.json({ error: message }, { status });
  }
};

export const DELETE: APIRoute = async ({ locals }) => {
  const identity = identityFor(locals);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  await deleteZoteroConnection(ownerKeyFor(identity.email));
  return Response.json({ ok: true });
};
