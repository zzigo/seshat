import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { bookmarkGroupColor, bookmarkGroupIcon, bookmarkGroupName } from '../../../lib/bookmark-groups';

const owner = (locals: App.Locals): string | null => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  return email ? ownerKeyFor(email) : null;
};

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const ownerKey = owner(locals);
  if (!ownerKey) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const input: { name?: string; color?: string; icon?: string } = {};
  if (body && Object.prototype.hasOwnProperty.call(body, 'name')) {
    input.name = bookmarkGroupName(body.name);
    if (!input.name) return Response.json({ error: 'A bookmark-group name is required.' }, { status: 400 });
  }
  if (body && Object.prototype.hasOwnProperty.call(body, 'color')) input.color = bookmarkGroupColor(body.color);
  if (body && Object.prototype.hasOwnProperty.call(body, 'icon')) input.icon = bookmarkGroupIcon(body.icon);
  if (!Object.keys(input).length) return Response.json({ error: 'No changes received.' }, { status: 400 });
  try {
    const group = await getCatalog().updateBookmarkGroup(ownerKey, params.id || '', input);
    return group ? Response.json({ ok: true, group }) : Response.json({ error: 'not_found' }, { status: 404 });
  } catch (error: any) {
    const conflict = String(error?.code || '') === '23505';
    return Response.json({ error: conflict ? 'A bookmark group with that name already exists.' : 'The bookmark group could not be updated.' }, { status: conflict ? 409 : 400 });
  }
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const ownerKey = owner(locals);
  if (!ownerKey) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const deleted = await getCatalog().deleteBookmarkGroup(ownerKey, params.id || '');
  return deleted ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
};
