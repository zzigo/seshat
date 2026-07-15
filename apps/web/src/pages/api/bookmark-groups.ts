import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../lib/catalog';
import { bookmarkGroupColor, bookmarkGroupIcon, bookmarkGroupName } from '../../lib/bookmark-groups';

const owner = (locals: App.Locals): string | null => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  return email ? ownerKeyFor(email) : null;
};

export const GET: APIRoute = async ({ locals }) => {
  const ownerKey = owner(locals);
  if (!ownerKey) return Response.json({ error: 'authentication_required' }, { status: 401 });
  return Response.json({ groups: await getCatalog().listBookmarkGroups(ownerKey) });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const ownerKey = owner(locals);
  if (!ownerKey) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const name = bookmarkGroupName(body?.name);
  if (!name) return Response.json({ error: 'A bookmark-group name is required.' }, { status: 400 });
  try {
    const group = await getCatalog().createBookmarkGroup(ownerKey, name, bookmarkGroupColor(body?.color), bookmarkGroupIcon(body?.icon));
    return Response.json({ ok: true, group }, { status: 201 });
  } catch (error: any) {
    const conflict = String(error?.code || '') === '23505';
    return Response.json({ error: conflict ? 'A bookmark group with that name already exists.' : 'The bookmark group could not be created.' }, { status: conflict ? 409 : 400 });
  }
};
