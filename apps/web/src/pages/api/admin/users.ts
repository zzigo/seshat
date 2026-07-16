import type { APIRoute } from 'astro';
import { isSessionAccountAdmin, sessionIdentity } from '../../../lib/catalog';
import { listAdminUsers } from '../../../lib/user-accounts';

export const GET: APIRoute = async ({ locals }) => {
  const session = (locals as any).session;
  if (!sessionIdentity(session).email) return Response.json({ error:'authentication_required' }, { status:401 });
  if (!isSessionAccountAdmin(session)) return Response.json({ error:'admin_required' }, { status:403 });
  return Response.json({ users:await listAdminUsers() });
};
