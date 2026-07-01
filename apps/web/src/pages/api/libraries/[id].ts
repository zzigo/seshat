import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const identity = (locals: App.Locals): string => String((locals.session as any)?.user?.email || '').trim().toLowerCase();

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const input: { name?: string; parentId?: string | null } = {};
  if (body && Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = String(body.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 160) return Response.json({ error: 'Library name must contain 1–160 characters.' }, { status: 400 });
    input.name = name;
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'parentId')) input.parentId = String(body.parentId || '') || null;
  if (!Object.keys(input).length) return Response.json({ error: 'No library changes received.' }, { status: 400 });
  try {
    const library = await getCatalog().updateLibrary(ownerKeyFor(email), params.id || '', input);
    if (!library) return Response.json({ error: 'not_found_or_protected' }, { status: 404 });
    return Response.json({ ok: true, library });
  } catch (error: any) {
    const code = String(error?.code || error?.message || '');
    const conflict = code === '23505';
    return Response.json({ error: conflict ? 'A library with that name already exists.' : code === 'LIBRARY_CYCLE' ? 'A folder cannot contain itself.' : 'The library could not be updated.' }, { status: conflict ? 409 : 400 });
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const deleted = await getCatalog().deleteLibrary(ownerKeyFor(email), params.id || '');
  return deleted ? Response.json({ ok: true }) : Response.json({ error: 'not_found_or_protected' }, { status: 404 });
};
