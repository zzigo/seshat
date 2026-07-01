import type { EnrichmentStage } from '@seshat/catalog';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const actions: Record<string, EnrichmentStage> = {
  'reprocess-metadata': 'identify',
  summarize: 'summarize',
};

export const POST: APIRoute = async ({ request, locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const body = await request.json().catch(() => null) as { ids?: unknown; action?: unknown } | null;
  const action = String(body?.action || '');
  const stage = actions[action];
  if (!stage) return Response.json({ error: 'unsupported_action' }, { status: 400 });
  const ids = Array.isArray(body?.ids)
    ? [...new Set(body.ids.map((id) => String(id || '').trim()).filter(Boolean))].slice(0, 200)
    : [];
  if (!ids.length) return Response.json({ error: 'missing_ids' }, { status: 400 });

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);
  let queued = 0;
  for (const id of ids) {
    if (await catalog.queueEnrichment(ownerKey, id, stage)) queued += 1;
  }
  return Response.json({ ok: true, action, stage, queued, requested: ids.length });
};
