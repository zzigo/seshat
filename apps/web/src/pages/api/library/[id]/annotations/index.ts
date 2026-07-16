import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../../lib/catalog';

const colors = new Set(['#2ea8e5', '#5fb236', '#a28ae5', '#ffd400', '#ff6666', '#f19837', '#e56eee', '#aaaaaa']);
const categories = new Set(['concept', 'main-idea', 'research-development', 'evidence', 'question-opposition', 'methodology', 'connection', 'misc']);
const cleanList = (value: unknown) => Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 30) : [];
const cleanRects = (value: unknown) => Array.isArray(value) ? value.slice(0, 100).map((rect) => ({
  x: Number(rect?.x), y: Number(rect?.y), width: Number(rect?.width), height: Number(rect?.height),
})).filter((rect) => Object.values(rect).every(Number.isFinite)
  && rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0
  && rect.x + rect.width <= 1.01 && rect.y + rect.height <= 1.01) : [];

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(email); const catalog = getCatalog(); const referenceId = params.id || '';
  if (!await catalog.get(ownerKey, referenceId)) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ annotations: await catalog.listAnnotations(ownerKey, referenceId) });
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(email); const catalog = getCatalog(); const referenceId = params.id || '';
  if (!await catalog.get(ownerKey, referenceId)) return Response.json({ error: 'not_found' }, { status: 404 });
  const body = await request.json().catch(() => null); const quote = String(body?.quote || '');
  const startOffset = Number(body?.startOffset); const endOffset = Number(body?.endOffset);
  const color = String(body?.color || '').toLowerCase(); const category = String(body?.category || '');
  const requestedSourceKind = String(body?.sourceKind || 'markdown');
  const sourceKind = ['pdf','epub','html'].includes(requestedSourceKind) ? requestedSourceKind : 'markdown'; const rects = cleanRects(body?.rects);
  if (!quote.trim() || quote.length > 20_000 || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || startOffset < 0 || endOffset <= startOffset) {
    return Response.json({ error: 'invalid_selector' }, { status: 400 });
  }
  if (!colors.has(color) || !categories.has(category)) return Response.json({ error: 'invalid_semantics' }, { status: 400 });
  const annotation = await catalog.createAnnotation(ownerKey, referenceId, {
    quote, startOffset, endOffset, sourceKind, rects, color, category,
    prefix: String(body?.prefix || '').slice(-250), suffix: String(body?.suffix || '').slice(0, 250),
    page: Number.isInteger(Number(body?.page)) && Number(body.page) > 0 ? Number(body.page) : undefined,
    locator: String(body?.locator || '').trim().slice(0, 120) || undefined,
    noteType: String(body?.noteType || '').trim().slice(0, 40) || undefined,
    note: String(body?.note || '').trim().slice(0, 20_000) || undefined,
    tags: cleanList(body?.tags), targets: cleanList(body?.targets),
    reviewStatus: String(body?.reviewStatus || 'captured').trim().slice(0, 40),
  });
  return Response.json({ annotation }, { status: 201 });
};
