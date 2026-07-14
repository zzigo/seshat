import type { APIRoute } from 'astro';
import { normalizeSmartFolderFilters, smartFolderHasFilters } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const identity = (locals: App.Locals): string => String((locals.session as any)?.user?.email || '').trim().toLowerCase();

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const input: { name?: string; filters?: ReturnType<typeof normalizeSmartFolderFilters> } = {};
  if (body && Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 160);
    if (!name) return Response.json({ error: 'Smart-folder name must contain 1–160 characters.' }, { status: 400 });
    input.name = name;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'filters')) {
    const filters = normalizeSmartFolderFilters(body.filters);
    if (!smartFolderHasFilters(filters)) return Response.json({ error: 'Add at least one filter.' }, { status: 400 });
    input.filters = filters;
  }
  if (!Object.keys(input).length) return Response.json({ error: 'No smart-folder changes received.' }, { status: 400 });
  try {
    const smartFolder = await getCatalog().updateSmartFolder(ownerKeyFor(email), params.id || '', input);
    return smartFolder ? Response.json({ ok: true, smartFolder }) : Response.json({ error: 'not_found' }, { status: 404 });
  } catch (error: any) {
    const conflict = String(error?.code || '') === '23505';
    return Response.json({ error: conflict ? 'A smart folder with that name already exists.' : 'The smart folder could not be updated.' }, { status: conflict ? 409 : 400 });
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const deleted = await getCatalog().deleteSmartFolder(ownerKeyFor(email), params.id || '');
  return deleted ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
};
