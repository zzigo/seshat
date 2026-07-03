import type { APIRoute } from 'astro';
import { contributorName } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { authenticateIntegration } from '../../../../lib/integration-auth';

export const GET: APIRoute = async ({ request, url }) => {
  const integration = authenticateIntegration(request);
  if (!integration) return Response.json({ error: 'integration_authentication_required' }, { status: 401 });

  const query = String(url.searchParams.get('q') || '').trim().slice(0, 200);
  const libraryId = String(url.searchParams.get('libraryId') || '').trim().slice(0, 200) || undefined;
  const requestedLimit = Number(url.searchParams.get('limit') || 20);
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(50, Math.trunc(requestedLimit))) : 20;

  try {
    const references = await getCatalog().searchCitations(
      integration.ownerKey || ownerKeyFor(integration.email || ''), query, limit, libraryId,
    );
    return Response.json({ items: references.map((reference) => ({
      id: reference.id,
      citeKey: reference.citeKey,
      type: reference.type,
      title: reference.title,
      authors: reference.contributors.filter((person: any) => String(person?.role || 'author') === 'author').map((person: any) => contributorName(person, true)).filter(Boolean),
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
