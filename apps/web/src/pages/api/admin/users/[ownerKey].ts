import type { APIRoute } from 'astro';
import { isSessionAccountAdmin, sessionIdentity } from '../../../../lib/catalog';
import { setAccountApproval } from '../../../../lib/user-accounts';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const session = (locals as any).session; const identity = sessionIdentity(session);
  if (!identity.email) return Response.json({ error:'authentication_required' }, { status:401 });
  if (!isSessionAccountAdmin(session)) return Response.json({ error:'admin_required' }, { status:403 });
  const body = await request.json().catch(() => null) as any;
  const action = String(body?.action || '');
  if (!['approve','suspend','restore'].includes(action)) return Response.json({ error:'invalid_action' }, { status:400 });
  const quotaBytes = Math.max(0, Math.min(10 * 1024 ** 3, Number(body?.quotaBytes || 0)));
  try { return Response.json(await setAccountApproval(String(params.ownerKey || ''), action as any, identity.email, quotaBytes)); }
  catch (error) { return Response.json({ error:error instanceof Error ? error.message : 'update_failed' }, { status:400 }); }
};
