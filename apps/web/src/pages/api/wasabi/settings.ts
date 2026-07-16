import type { APIRoute } from 'astro';
import { ownerKeyFor, sessionIdentity } from '../../../lib/catalog';
import { getWasabiLibraryRoot, saveWasabiLibraryRoot } from '../../../lib/wasabi-settings';

const identityFor = (locals: App.Locals) => sessionIdentity((locals as any).session);

export const GET: APIRoute = async ({ locals }) => {
  const identity = identityFor(locals);
  if (!identity.email) return Response.json({ error:'authentication_required' }, { status:401 });
  const root = await getWasabiLibraryRoot(ownerKeyFor(identity.email), identity);
  return Response.json({ root });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const identity = identityFor(locals);
  if (!identity.email) return Response.json({ error:'authentication_required' }, { status:401 });
  const body = await request.json().catch(() => null) as { root?:unknown } | null;
  try {
    const root = await saveWasabiLibraryRoot(ownerKeyFor(identity.email), identity, body?.root);
    return Response.json({ root });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INVALID_WASABI_LIBRARY_ROOT';
    return Response.json({ error:message }, { status:400 });
  }
};
