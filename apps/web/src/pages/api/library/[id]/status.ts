import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '');
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const reference = await getCatalog().get(ownerKeyFor(email), params.id || '');
  if (!reference) return Response.json({ error: 'not_found' }, { status: 404 });
  const active = reference.jobs.find((job) => job.status === 'running' || job.status === 'queued');
  const failed = reference.jobs.find((job) => job.status === 'failed');
  const identify = reference.jobs.find((job) => job.stage === 'identify');
  return Response.json({
    reference: {
      id: reference.id,
      citeKey: reference.citeKey,
      type: reference.type,
      title: reference.title,
      authors: reference.contributors.map((contributor: any) => contributor.literal
        || [contributor.family, contributor.given].filter(Boolean).join(', ')).filter(Boolean).join('; '),
      year: (reference.issued as any)?.year || '',
      isbn: ((reference.identifiers.isbn as string[] | undefined) || []).join('; '),
      language: reference.language || '',
      tags: reference.tags.join(', '),
      abstract: reference.abstract || '',
      publisher: reference.publisher || '',
      publisherPlace: reference.publisherPlace || '',
      url: reference.url || '',
      format: String((reference.source as any).originalFilename || '').split('.').pop()?.toLowerCase() || 'document',
      filename: String((reference.source as any).originalFilename || reference.title),
      libraryIds: reference.libraryIds,
      status: failed ? 'failed' : active?.stage || 'catalogued',
      hasStructure: reference.artifacts.some((artifact) => artifact.kind === 'structure'),
      hasText: reference.artifacts.some((artifact) => artifact.kind === 'markdown'),
    },
    pipeline: reference.jobs,
    ready: identify?.status === 'complete',
    failed: failed?.error || null,
  });
};
