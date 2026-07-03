import { defineMiddleware } from 'astro:middleware';
import { getSession } from 'auth-astro/server';
import { registerSessionIdentity } from './lib/catalog';

const protectedPaths = ['/workspace', '/dashboard', '/intake', '/library', '/bibliography', '/api/account', '/api/intake', '/api/library', '/api/libraries', '/api/bibliography'];

export const onRequest = defineMiddleware(async (context, next) => {
  let session = null;
  try {
    session = await getSession(context.request);
  } catch {
    // Public pages remain available if the identity provider is temporarily unavailable.
  }

  context.locals.session = session;
  if (session?.user?.email) await registerSessionIdentity(session).catch((error) => console.error('[seshat:identity]', error));

  if (protectedPaths.some((path) => context.url.pathname.startsWith(path)) && !session?.user?.email) {
    if (context.url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'authentication_required' }, { status: 401 });
    }
    const redirect = `${context.url.pathname}${context.url.search}`;
    return context.redirect(`/login?redirect=${encodeURIComponent(redirect)}`);
  }

  return next();
});
