import type { APIRoute } from 'astro';
import { contributorSummary } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { referenceFileType } from '../../../../lib/reference-file';

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '');
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const reference = await getCatalog().get(ownerKeyFor(email), params.id || '');
  if (!reference) return Response.json({ error: 'not_found' }, { status: 404 });
  const active = reference.jobs.find((job) => job.status === 'running' || job.status === 'queued');
  const failed = reference.jobs.find((job) => job.status === 'failed');
  const identify = reference.jobs.find((job) => job.stage === 'identify');
  const summarize = reference.jobs.find((job) => job.stage === 'summarize');
  const hasOriginal = reference.artifacts.some((artifact) => artifact.kind === 'original');
  const hasText = reference.artifacts.some((artifact) => artifact.kind === 'markdown');
  const format = referenceFileType(reference);
  const paper = format === 'pdf' ? await getCatalog().getPaper(ownerKeyFor(email), reference.id) : null;
  const paperStatus = !paper ? null : paper.resolutionStatus === 'ambiguous'
    ? 'ambiguous'
    : paper.resolutionStatus === 'resolved'
      ? 'ready'
      : active?.stage === 'extract'
        ? 'extracting'
        : active?.stage === 'scholarly'
          ? 'resolving'
          : paper.resolutionStatus;
  return Response.json({
    reference: {
      id: reference.id,
      citeKey: reference.citeKey,
      type: reference.type,
      title: reference.title,
      contributors: reference.contributors,
      contributorsDisplay: contributorSummary(reference.contributors as any),
      year: (reference.issued as any)?.year || '',
      isbn: ((reference.identifiers.isbn as string[] | undefined) || []).join('; '),
      language: reference.language || '',
      tags: reference.tags.join(', '),
      abstract: reference.abstract || '',
      publisher: reference.publisher || '',
      publisherPlace: reference.publisherPlace || '',
      url: reference.url || '',
      format,
      fileType: format.toUpperCase() || '—',
      filename: String((reference.source as any).originalFilename || reference.title),
      libraryIds: reference.libraryIds,
      status: failed ? 'failed' : (active?.stage || (!hasOriginal ? 'missing file' : !hasText ? 'no extracted text' : 'ready')),
      hasOriginal,
      hasStructure: reference.artifacts.some((artifact) => artifact.kind === 'structure'),
      hasText,
      needsOcr: format === 'pdf' && hasOriginal && (!hasText || reference.wordCount < 20),
      paperStatus,
    },
    paper: paper ? {
      status: paper.resolutionStatus,
      method: paper.resolutionMethod,
      confidence: paper.resolutionConfidence,
      openAlexId: paper.openAlexId,
      candidates: paper.candidates,
    } : null,
    pipeline: reference.jobs,
    ready: identify?.status === 'complete' && summarize?.status === 'complete',
    failed: failed?.error || null,
  });
};
