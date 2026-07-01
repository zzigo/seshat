import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { authenticateIntegration } from '../../../../lib/integration-auth';

const contributorName = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const contributor = value as Record<string, unknown>;
  if (contributor.literal) return String(contributor.literal);
  return [contributor.family, contributor.given].filter(Boolean).map(String).join(', ');
};

export const GET: APIRoute = async ({ request, url }) => {
  const integration = authenticateIntegration(request);
  if (!integration) return Response.json({ error: 'integration_authentication_required' }, { status: 401 });

  const query = String(url.searchParams.get('q') || '').trim().slice(0, 200);
  const libraryId = String(url.searchParams.get('libraryId') || '').trim().slice(0, 200) || undefined;
  const requestedLimit = Number(url.searchParams.get('limit') || 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 20;

  try {
    const references = await getCatalog().searchCitations(
      ownerKeyFor(integration.email), query, limit, libraryId,
    );
    return Response.json({ items: references.map((reference) => ({
      id: reference.id,
      citeKey: reference.citeKey,
      type: reference.type,
      title: reference.title,
      authors: reference.contributors.map(contributorName).filter(Boolean),
      year: Number((reference.issued as Record<string, unknown> | undefined)?.year) || null,
      identifiers: reference.identifiers,
      tags: reference.tags,
      language: reference.language || null,
      libraryIds: reference.libraryIds,
      updatedAt: reference.updatedAt,
    })) }, { headers: { 'Cache-Control': 'private, max-age=15' } });
  } catch (error) {
    console.error('[seshat:integration:citations:search]', error);
    return Response.json({ error: 'citation_search_failed' }, { status: 500 });
  }
};
