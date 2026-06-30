import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../lib/catalog';

export const POST: APIRoute = async ({ request, locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = String(body?.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 160) return Response.json({ error: 'Library name must contain 1–160 characters.' }, { status: 400 });
  try {
    const library = await getCatalog().createLibrary(ownerKeyFor(email), name, String(body?.parentId || '') || undefined);
    return Response.json({ ok: true, library }, { status: 201 });
  } catch (error: any) {
    const conflict = String(error?.code || '') === '23505';
    return Response.json({ error: conflict ? 'A library with that name already exists.' : 'The library could not be created.' }, { status: conflict ? 409 : 400 });
  }
};
