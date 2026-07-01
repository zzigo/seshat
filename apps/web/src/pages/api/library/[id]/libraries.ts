import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

export const POST: APIRoute = async ({ request, locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const libraryId = String(body?.libraryId || '');
  if (!libraryId) return Response.json({ error: 'library_required' }, { status: 400 });
  const ownerKey = ownerKeyFor(email);
  const reference = await getCatalog().get(ownerKey, params.id || '');
  if (!reference) return Response.json({ error: 'not_found' }, { status: 404 });
  await getCatalog().addToLibrary(ownerKey, reference.id, libraryId);
  const updated = await getCatalog().get(ownerKey, reference.id);
  return Response.json({ ok: true, libraryIds: updated?.libraryIds || [] });
};

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const libraryIds = Array.isArray(body?.libraryIds) ? body.libraryIds.map(String).filter(Boolean).slice(0, 100) : null;
  if (!libraryIds) return Response.json({ error: 'library_ids_required' }, { status: 400 });
  try {
    const updated = await getCatalog().setReferenceLibraries(ownerKeyFor(email), params.id || '', libraryIds);
    return Response.json({ ok: true, libraryIds: updated });
  } catch (error: any) {
    const missing = ['REFERENCE_NOT_FOUND', 'LIBRARY_NOT_FOUND'].includes(String(error?.message || ''));
    return Response.json({ error: missing ? String(error.message).toLowerCase() : 'The reference could not be moved.' }, { status: missing ? 404 : 400 });
  }
};
