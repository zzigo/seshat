import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import { getUserAccount, updateOnboarding } from '../../../lib/user-accounts';

export const GET: APIRoute = async ({ locals }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error:'authentication_required' }, { status:401 });
  return Response.json(await getUserAccount(ownerKeyFor(identity.email)));
};

export const POST: APIRoute = async ({ request, locals }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error:'authentication_required' }, { status:401 });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return Response.json({ error:'invalid_request' }, { status:400 });
  try { return Response.json(await updateOnboarding(ownerKeyFor(identity.email), body)); }
  catch (error) { return Response.json({ error:error instanceof Error ? error.message : 'onboarding_failed' }, { status:400 }); }
};
