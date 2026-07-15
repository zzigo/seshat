import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

export const PUT: APIRoute = async ({ request, locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const referenceIds = Array.isArray(body?.referenceIds) ? body.referenceIds.map(String) : [];
  if (!referenceIds.length) return Response.json({ error: 'Select at least one item.' }, { status: 400 });
  const enabled = body?.enabled !== false;
  const changed = await getCatalog().setBookmarkMembership(ownerKeyFor(email), params.id || '', referenceIds, enabled);
  return Response.json({ ok: true, changed, enabled });
};
