import type { APIRoute } from 'astro';
import { getCatalog, hashedOwnerKeyFor, isSessionAccountAdmin, ownerKeyFor, sessionIdentity, setSessionOwnerAlias } from '../../../lib/catalog';

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session; const identity = sessionIdentity(session);
  if (!identity.email || !identity.subject) return Response.json({ error: 'stable_identity_required' }, { status: 401 });
  if (!isSessionAccountAdmin(session)) return Response.json({ error: 'account_admin_required' }, { status: 403 });
  const body = await request.json().catch(() => null); const previousEmail = String(body?.previousEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(previousEmail)) return Response.json({ error: 'valid_previous_email_required' }, { status: 400 });
  const currentOwnerKey = ownerKeyFor(identity.email); const targetOwnerKey = hashedOwnerKeyFor(previousEmail);
  if (currentOwnerKey === targetOwnerKey) return Response.json({ error: 'catalog_already_current' }, { status: 409 });
  const result = await getCatalog().recoverIdentity(identity.identityKey, currentOwnerKey, targetOwnerKey, identity.email);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 409 });
  setSessionOwnerAlias(session, targetOwnerKey);
  console.info('[seshat:identity-recovery]', { identityKey: identity.identityKey, targetOwnerPrefix: targetOwnerKey.slice(0, 8) });
  return Response.json({ ok: true });
};
