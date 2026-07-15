import type { APIRoute } from 'astro';
import { contributorSummary } from '@seshat/core';
import { getCatalog, ownerKeyFor, sessionIdentity } from '../../../lib/catalog';

export const GET: APIRoute = async ({ locals, url }) => {
  const identity = sessionIdentity((locals as any).session);
  if (!identity.email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const query = String(url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!query) return Response.json({ items: [] }, { headers: { 'Cache-Control': 'private, no-store' } });

  try {
    const references = await getCatalog().searchCitations(ownerKeyFor(identity.email), query, 50);
    return Response.json({
      items: references.map((reference) => ({
        id: reference.id,
        citeKey: reference.citeKey,
        type: reference.type,
        title: reference.title,
        persons: contributorSummary(reference.contributors as Parameters<typeof contributorSummary>[0]),
        year: Number((reference.issued as Record<string, unknown> | undefined)?.year) || null,
        language: reference.language || null,
      })),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[seshat:item-search]', error);
    return Response.json({ error: 'item_search_failed' }, { status: 500 });
  }
};
