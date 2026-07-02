import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../../lib/catalog';

const colors = new Set(['#2ea8e5', '#5fb236', '#a28ae5', '#ffd400', '#ff6666', '#f19837', '#e56eee', '#aaaaaa']);
const categories = new Set(['concept', 'main-idea', 'research-development', 'evidence', 'question-opposition', 'methodology', 'connection', 'misc']);
const cleanList = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 30) : undefined;

const context = (locals: any, params: Record<string, string | undefined>) => {
  const email = String(locals.session?.user?.email || '').trim().toLowerCase();
  return { email, ownerKey: email ? ownerKeyFor(email) : '', referenceId: params.id || '', annotationId: params.annotationId || '' };
};

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const auth = context(locals, params); if (!auth.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const catalog = getCatalog(); if (!await catalog.get(auth.ownerKey, auth.referenceId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await request.json().catch(() => null); if (!body || typeof body !== 'object') return Response.json({ error: 'invalid_body' }, { status: 400 });
  const input: Record<string, unknown> = {};
  if ('color' in body) { const color = String(body.color).toLowerCase(); if (!colors.has(color)) return Response.json({ error: 'invalid_color' }, { status: 400 }); input.color = color; }
  if ('category' in body) { const category = String(body.category); if (!categories.has(category)) return Response.json({ error: 'invalid_category' }, { status: 400 }); input.category = category; }
  if ('noteType' in body) input.noteType = String(body.noteType || '').trim().slice(0, 40) || undefined;
  if ('note' in body) input.note = String(body.note || '').trim().slice(0, 20_000) || undefined;
  if ('locator' in body) input.locator = String(body.locator || '').trim().slice(0, 120) || undefined;
  if ('page' in body) input.page = Number.isInteger(Number(body.page)) && Number(body.page) > 0 ? Number(body.page) : undefined;
  if ('tags' in body) input.tags = cleanList(body.tags);
  if ('targets' in body) input.targets = cleanList(body.targets);
  if ('reviewStatus' in body) input.reviewStatus = String(body.reviewStatus || 'captured').trim().slice(0, 40);
  const annotation = await catalog.updateAnnotation(auth.ownerKey, auth.referenceId, auth.annotationId, input);
  return annotation ? Response.json({ annotation }) : Response.json({ error: 'not_found' }, { status: 404 });
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const auth = context(locals, params); if (!auth.email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const catalog = getCatalog(); if (!await catalog.get(auth.ownerKey, auth.referenceId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const deleted = await catalog.deleteAnnotation(auth.ownerKey, auth.referenceId, auth.annotationId);
  return deleted ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
};
