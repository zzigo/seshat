import { defineMiddleware } from 'astro:middleware';
import { getSession } from 'auth-astro/server';
import { registerSessionIdentity } from './lib/catalog';

const protectedPaths = ['/workspace', '/dashboard', '/intake', '/library', '/bibliography', '/api/account', '/api/intake', '/api/library', '/api/libraries', '/api/bibliography', '/api/zotero'];

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

  const response = await next();
  if (context.url.pathname === '/workspace') {
    response.headers.set('Content-Security-Policy', [
      "default-src 'self'",
      "script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com",
      "script-src-elem 'self' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: blob:",
      "media-src 'self' blob:",
      "connect-src 'self' https://cloudflareinsights.com https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.xethub.hf.co https://cdn.jsdelivr.net",
      "frame-src 'self' blob:",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '));
  }
  return response;
});
