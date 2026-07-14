import type { APIRoute } from 'astro';
import { normalizeSmartFolderFilters, smartFolderHasFilters } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../lib/catalog';

const identity = (locals: App.Locals): string => String((locals.session as any)?.user?.email || '').trim().toLowerCase();
const folderName = (value: unknown): string => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);

export const GET: APIRoute = async ({ locals }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  return Response.json({ smartFolders: await getCatalog().listSmartFolders(ownerKeyFor(email)) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = folderName(body?.name);
  const filters = normalizeSmartFolderFilters(body?.filters);
  if (!name) return Response.json({ error: 'Smart-folder name must contain 1–160 characters.' }, { status: 400 });
  if (!smartFolderHasFilters(filters)) return Response.json({ error: 'Add at least one filter.' }, { status: 400 });
  try {
    const smartFolder = await getCatalog().createSmartFolder(ownerKeyFor(email), name, filters);
    return Response.json({ ok: true, smartFolder }, { status: 201 });
  } catch (error: any) {
    const conflict = String(error?.code || '') === '23505';
    return Response.json({ error: conflict ? 'A smart folder with that name already exists.' : 'The smart folder could not be created.' }, { status: conflict ? 409 : 400 });
  }
};
