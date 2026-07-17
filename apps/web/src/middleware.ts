import { defineMiddleware } from 'astro:middleware';
import { getSession } from 'auth-astro/server';
import { registerSessionIdentity } from './lib/catalog';
import { registerSessionAccount } from './lib/user-accounts';

const protectedPaths = ['/work', '/mobwork', '/dashboard', '/search', '/admin', '/intake', '/library', '/bibliography', '/api/account', '/api/admin', '/api/intake', '/api/library', '/api/libraries', '/api/bibliography', '/api/zotero', '/api/storage'];
const onboardingPaths = ['/welcome', '/en/welcome', '/es/welcome', '/pending', '/api/account/onboarding', '/api/storage/google', '/api/zotero/connection'];

export const onRequest = defineMiddleware(async (context, next) => {
  let session = null;
  try {
    session = await getSession(context.request);
  } catch {
    // Public pages remain available if the identity provider is temporarily unavailable.
  }

  context.locals.session = session;
  let account = null;
  if (session?.user?.email) {
    try {
      const ownerKey = await registerSessionIdentity(session);
      account = await registerSessionAccount(session, ownerKey);
    } catch (error) { console.error('[seshat:identity]', error); }
  }
  context.locals.account = account;

  if (protectedPaths.some((path) => context.url.pathname.startsWith(path)) && !session?.user?.email) {
    if (context.url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'authentication_required' }, { status: 401 });
    }
    const redirect = `${context.url.pathname}${context.url.search}`;
    return context.redirect(`/login?redirect=${encodeURIComponent(redirect)}`);
  }

  const protectedRequest = protectedPaths.some((path) => context.url.pathname.startsWith(path));
  const onboardingRequest = onboardingPaths.some((path) => context.url.pathname.startsWith(path));
  if (session?.user?.email && protectedRequest && !onboardingRequest && account?.status !== 'approved') {
    if (context.url.pathname.startsWith('/api/')) {
      return Response.json({ error: account?.status === 'suspended' ? 'account_suspended' : 'account_approval_required' }, { status: 403 });
    }
    return context.redirect(account?.status === 'suspended' ? '/pending?state=suspended' : `/${account?.locale || 'en'}/welcome`);
  }

  const response = await next();
  if (context.url.pathname === '/workspace' || context.url.pathname === '/mobwork') {
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
