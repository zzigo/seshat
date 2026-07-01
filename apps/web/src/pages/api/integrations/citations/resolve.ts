import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { authenticateIntegration } from '../../../../lib/integration-auth';

const cslType = (type: string): string => {
  const supported = new Set([
    'article', 'article-journal', 'book', 'chapter', 'document',
    'paper-conference', 'report', 'thesis',
  ]);
  return supported.has(type) ? type : 'document';
};

const cslAuthor = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== 'object') return null;
  const contributor = value as Record<string, unknown>;
  if (contributor.literal) return { literal: String(contributor.literal) };
  const author: Record<string, string> = {};
  if (contributor.family) author.family = String(contributor.family);
  if (contributor.given) author.given = String(contributor.given);
  return Object.keys(author).length ? author : null;
};

export const GET: APIRoute = async ({ request, url }) => {
  const integration = authenticateIntegration(request);
  if (!integration) return Response.json({ error: 'integration_authentication_required' }, { status: 401 });

  const keys = [...url.searchParams.getAll('key'), ...String(url.searchParams.get('keys') || '').split(',')]
    .map((key) => key.trim()).filter((key) => /^[A-Za-z0-9:_-]{1,160}$/.test(key)).slice(0, 100);
  if (!keys.length) return Response.json({ items: [], missing: [] });

  try {
    const references = await getCatalog().resolveCitationKeys(
      integration.ownerKey || ownerKeyFor(integration.email || ''), keys,
    );
    const found = new Set(references.map((reference) => reference.citeKey));
    return Response.json({
      items: references.map((reference) => {
        const identifiers = reference.identifiers as Record<string, unknown>;
        const year = Number((reference.issued as Record<string, unknown> | undefined)?.year) || undefined;
        const item: Record<string, unknown> = {
          id: reference.citeKey,
          type: cslType(reference.type),
          title: reference.title,
          author: reference.contributors.map(cslAuthor).filter(Boolean),
        };
        if (year) item.issued = { 'date-parts': [[year]] };
        if (reference.language) item.language = reference.language;
        if (identifiers.doi) item.DOI = Array.isArray(identifiers.doi) ? identifiers.doi[0] : identifiers.doi;
        if (identifiers.isbn) item.ISBN = Array.isArray(identifiers.isbn) ? identifiers.isbn.join(' ') : identifiers.isbn;
        return item;
      }),
      missing: keys.filter((key) => !found.has(key)),
    }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    console.error('[seshat:integration:citations:resolve]', error);
    return Response.json({ error: 'citation_resolution_failed' }, { status: 500 });
  }
};
