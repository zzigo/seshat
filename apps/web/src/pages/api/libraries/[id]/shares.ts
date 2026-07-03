import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

const identity = (locals: App.Locals): string =>
  String((locals.session as any)?.user?.email || '').trim().toLowerCase();

export const GET: APIRoute = async ({ locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const shares = await getCatalog().listLibraryShares(ownerKeyFor(email), params.id || '');
  return shares ? Response.json({ shares }) : Response.json({ error: 'not_found' }, { status: 404 });
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const requestedEmails: unknown[] = Array.isArray(body?.emails) ? body.emails : [body?.email];
  const granteeEmails: string[] = Array.from(new Set<string>(
    requestedEmails.map((value: unknown) => String(value || '').trim().toLowerCase()).filter(Boolean),
  )).slice(0, 200);
  if (!granteeEmails.length || granteeEmails.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 320)) {
    return Response.json({ error: 'Enter a valid Musiki user email.' }, { status: 400 });
  }
  if (granteeEmails.includes(email)) return Response.json({ error: 'This library already belongs to you.' }, { status: 400 });

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);
  const shares = [];
  for (const granteeEmail of granteeEmails) {
    const share = await catalog.shareLibrary(
      ownerKey, params.id || '', ownerKeyFor(granteeEmail), granteeEmail, email,
    );
    if (!share) return Response.json({ error: 'not_found' }, { status: 404 });
    shares.push(share);
  }
  return Response.json({ ok: true, share: shares[0], shares }, { status: 201 });
};

export const DELETE: APIRoute = async ({ request, locals, params }) => {
  const email = identity(locals);
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const granteeEmail = String(new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!granteeEmail) return Response.json({ error: 'email_required' }, { status: 400 });
  const revoked = await getCatalog().revokeLibraryShare(ownerKeyFor(email), params.id || '', ownerKeyFor(granteeEmail));
  return revoked ? Response.json({ ok: true }) : Response.json({ error: 'not_found' }, { status: 404 });
};
