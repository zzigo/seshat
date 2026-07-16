import Google from '@auth/core/providers/google';
import { defineConfig } from 'auth-astro';

const env = (key: string): string | undefined =>
  typeof process !== 'undefined' ? process.env[key] : undefined;

const development = env('NODE_ENV') !== 'production';
const googleConfigured = Boolean(env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET'));
const logtoConfigured = Boolean(env('LOGTO_ISSUER_URL') && env('LOGTO_CLIENT_ID') && env('LOGTO_CLIENT_SECRET'));

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
      id: logtoConfigured ? 'logto' : 'authentik',
      name: logtoConfigured ? 'Logto' : 'Authentik',
      type: 'oidc',
      issuer: logtoConfigured ? env('LOGTO_ISSUER_URL') : env('OIDC_ISSUER_URL') || 'https://auth.musiki.org.ar/application/o/seshat/',
      clientId: logtoConfigured ? env('LOGTO_CLIENT_ID') : env('OIDC_CLIENT_ID'),
      clientSecret: logtoConfigured ? env('LOGTO_CLIENT_SECRET') : env('OIDC_CLIENT_SECRET'),
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
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) (token as any).signedInAt = new Date().toISOString();
      if (profile) {
        (token as any).identitySubject = String((profile as any).sub || token.sub || '');
        (token as any).identityProvider = String(account?.provider || 'oidc');
        (token as any).groups = Array.isArray((profile as any).groups) ? (profile as any).groups.map(String) : [];
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = String((token as any).identitySubject || token.sub || '');
        (session.user as any).provider = String((token as any).identityProvider || (logtoConfigured ? 'logto' : 'authentik'));
        (session.user as any).groups = Array.isArray((token as any).groups) ? (token as any).groups : [];
        (session.user as any).signedInAt = String((token as any).signedInAt || '');
      }
      return session;
    },
  },
});
