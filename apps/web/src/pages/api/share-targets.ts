import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const baseUrl = String(process.env.MUSIKI_API_URL || 'https://musiki.org.ar').trim().replace(/\/$/, '');
  const token = String(process.env.SESHAT_INTEGRATION_TOKEN || '').trim();
  if (!token) return Response.json({ error: 'Musiki integration is not configured.' }, { status: 503 });

  const upstream = new URL('/api/integrations/seshat/share-targets', baseUrl);
  upstream.searchParams.set('q', String(url.searchParams.get('q') || '').slice(0, 120));

  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Seshat-Owner': email,
      },
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => ({ error: 'Invalid response from Musiki.' }));
    if (!response.ok) {
      console.error('[seshat:musiki:share-targets]', response.status, payload);
      return Response.json({ error: 'Musiki users are unavailable.' }, { status: response.status === 401 ? 502 : response.status });
    }
    return Response.json(payload, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (error) {
    console.error('[seshat:musiki:share-targets]', error);
    return Response.json({ error: 'Musiki users are unavailable.' }, { status: 502 });
  }
};
