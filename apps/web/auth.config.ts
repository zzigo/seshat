import Google from '@auth/core/providers/google';
import { defineConfig } from 'auth-astro';

const env = (key: string): string | undefined =>
  typeof process !== 'undefined' ? process.env[key] : undefined;

const development = env('NODE_ENV') !== 'production';
const googleConfigured = Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));

if (typeof process !== 'undefined') process.env.AUTH_TRUST_HOST = 'true';

export default defineConfig({
  trustHost: true,
  basePath: '/api/auth',
  secret: env('AUTH_SECRET'),
  cookies: {
    sessionToken: {
      name: development ? 'seshat.session-token' : '__Secure-seshat.session-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: !development },
    },
    csrfToken: {
      name: development ? 'seshat.csrf-token' : '__Host-seshat.csrf-token',
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: !development },
    },
  },
  providers: [
    ...(googleConfigured ? [Google({
      clientId: env('GOOGLE_CLIENT_ID'),
      clientSecret: env('GOOGLE_CLIENT_SECRET'),
      allowDangerousEmailAccountLinking: true,
    })] : []),
    {
      id: 'authentik',
      name: 'Authentik',
      type: 'oidc',
      issuer: env('OIDC_ISSUER_URL') || 'https://auth.musiki.org.ar/application/o/seshat/',
      clientId: env('OIDC_CLIENT_ID'),
      clientSecret: env('OIDC_CLIENT_SECRET'),
      authorization: { params: { scope: 'openid profile email' } },
      checks: ['pkce', 'state'],
      client: { token_endpoint_auth_method: 'client_secret_post' },
      profile(profile) {
        return {
          id: String(profile.sub),
          name: profile.name ?? profile.preferred_username,
          email: profile.email,
          image: profile.picture,
        };
      },
    },
  ],
});
