import type { APIRoute } from 'astro';
import { persistResolution, rebuildScholarlyGraph } from '@seshat/catalog';
import { clampGraphExpansion, type OpenAlexResolution } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { getOpenAlexClient } from '../../../lib/openalex';

export const POST: APIRoute = async ({ request, locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const referenceId = String(body?.paperId || '').trim();
  if (!referenceId) return Response.json({ error: 'paper_id_required' }, { status: 400 });

  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  const paper = await catalog.getPaper(ownerKey, referenceId);
  if (!paper) return Response.json({ error: 'paper_not_found' }, { status: 404 });
  const options = clampGraphExpansion(body?.options || {});
  const client = getOpenAlexClient();

  try {
    if (!client.configured) {
      await rebuildScholarlyGraph(catalog, ownerKey);
      return Response.json({ ok: true, paper, options, source: 'extracted-bibliography', warning: 'openalex_not_configured' });
    }

    const metadata = paper.extractedMetadata as { doi?: unknown; title?: unknown; publicationYear?: unknown; authors?: unknown };
    let resolution: OpenAlexResolution;
    if (paper.openAlexId) {
      const work = await client.workById(paper.openAlexId);
      if (!work) return Response.json({ error: 'openalex_work_not_found' }, { status: 404 });
      resolution = { status: 'resolved', work, confidence: 1, method: 'openalex-id' };
    } else {
      resolution = await client.resolve({
        doi: paper.doi || String(metadata.doi || ''),
        title: String(metadata.title || paper.title),
        publicationYear: Number(metadata.publicationYear) || undefined,
        authors: Array.isArray(metadata.authors) ? metadata.authors.map(String) : [],
      });
    }
    const saved = await persistResolution(catalog, ownerKey, referenceId, resolution, options, client);
    return Response.json({ ok: true, paper: saved, options, source: resolution.status === 'resolved' ? 'openalex' : 'extracted-bibliography', resolutionStatus: resolution.status });
  } catch (error) {
    const message = String((error as Error)?.message || error);
    return Response.json({ error: message }, { status: message === 'OPENALEX_API_KEY_REQUIRED' ? 503 : 502 });
  }
};
