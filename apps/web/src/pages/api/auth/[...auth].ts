import { Auth } from '@auth/core';
import type { AuthAction } from '@auth/core/types';
import type { APIContext } from 'astro';
import { parseString } from 'set-cookie-parser';
import authConfig from 'auth:config';

const actions: AuthAction[] = [
  'providers', 'session', 'csrf', 'signin', 'signout', 'callback', 'verify-request', 'error',
];

const externalOrigin = (request: Request): URL => {
  const configured = process.env.AUTH_URL || process.env.SITE_URL;
  if (configured) return new URL(configured);
  const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.slice(0, -1);
  return forwardedHost ? new URL(`${forwardedProto}://${forwardedHost}`) : new URL(request.url);
};

const handleAuth = async ({ cookies, request }: APIContext) => {
  const origin = externalOrigin(request);
  const url = new URL(request.url);
  url.protocol = origin.protocol;
  url.host = origin.host;

  const headers = new Headers(request.headers);
  headers.set('host', origin.host);
  headers.set('x-forwarded-host', origin.host);
  headers.set('x-forwarded-proto', origin.protocol.slice(0, -1));

  const rewritten = new Request(url, {
    method: request.method,
    headers,
    body: request.method === 'POST' ? await request.clone().blob() : null,
    duplex: 'half',
  } as RequestInit);

  const prefix = authConfig.basePath || '/api/auth';
  const action = url.pathname.slice(prefix.length + 1).split('/')[0] as AuthAction;
  if (!actions.includes(action) || !url.pathname.startsWith(`${prefix}/`)) {
    return new Response('Not found', { status: 404 });
  }

  const response = await Auth(rewritten, authConfig);
  if (['callback', 'signin', 'signout'].includes(action)) {
    for (const cookie of response.headers.getSetCookie()) {
      const { name, value, ...options } = parseString(cookie);
      cookies.set(name, value, options as Parameters<typeof cookies.set>[2]);
    }
  }
  return response;
};

export const GET = handleAuth;
export const POST = handleAuth;
