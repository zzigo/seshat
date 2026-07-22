import { contributorSummary } from '@seshat/core';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { readingProgressPercent } from '../../../lib/reading-progress';
import { referenceFileType } from '../../../lib/reference-file';

export const GET: APIRoute = async ({ locals, url }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(email);
  const libraryId = String(url.searchParams.get('libraryId') || '').trim().slice(0, 200);
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 160);
  const view = url.searchParams.get('view') === 'recent' ? 'recent' : 'all';
  const limit = Math.max(20, Math.min(100, Math.trunc(Number(url.searchParams.get('limit') || 60))));
  const offset = Math.max(0, Math.min(1_000_000, Math.trunc(Number(url.searchParams.get('offset') || 0))));
  const catalog = getCatalog();
  await catalog.ensureSchema();
  const order = view === 'recent'
    ? 'state.updated_at DESC NULLS LAST, reference.updated_at DESC'
    : 'reference.updated_at DESC';
  const result = await catalog.pool.query(
    `WITH RECURSIVE branch(id) AS (
       SELECT id FROM catalog_libraries WHERE owner_key=$1 AND id=$2
       UNION ALL
       SELECT child.id FROM catalog_libraries child JOIN branch parent ON child.parent_id=parent.id
       WHERE child.owner_key=$1
     )
     SELECT reference.id,reference.title,reference.type,reference.contributors,reference.issued,
       reference.language,reference.source,reference.updated_at,state.location,state.updated_at AS read_at,
       original.mime_type,original.size_bytes,
       EXISTS (SELECT 1 FROM catalog_papers paper WHERE paper.owner_key=$1 AND paper.reference_id=reference.id AND paper.resolution_status='resolved' AND paper.openalex_id IS NOT NULL) AS has_openalex,
       EXISTS (SELECT 1 FROM catalog_annotations annotation WHERE annotation.owner_key=$1 AND annotation.reference_id=reference.id) AS has_annotations,
       EXISTS (SELECT 1 FROM catalog_artifacts artifact WHERE artifact.reference_id=reference.id AND artifact.kind='markdown') AS has_text,
       EXISTS (SELECT 1 FROM catalog_artifacts artifact WHERE artifact.reference_id=reference.id AND artifact.kind='structure') AS has_structure
     FROM catalog_references reference
     LEFT JOIN catalog_reading_state state ON state.owner_key=$1 AND state.reference_id=reference.id
     LEFT JOIN LATERAL (
       SELECT artifact.mime_type,artifact.size_bytes FROM catalog_artifacts artifact
       WHERE artifact.reference_id=reference.id AND artifact.kind='original'
       ORDER BY artifact.created_at LIMIT 1
     ) original ON true
     WHERE reference.owner_key=$1
       AND ($2='' OR EXISTS (
         SELECT 1 FROM catalog_library_items membership
         WHERE membership.reference_id=reference.id AND membership.library_id IN (SELECT id FROM branch)
       ))
       AND ($3='' OR reference.title ILIKE '%'||$3||'%' OR reference.cite_key ILIKE '%'||$3||'%'
         OR reference.contributors::text ILIKE '%'||$3||'%' OR COALESCE(reference.publisher,'') ILIKE '%'||$3||'%')
       AND ($4<>'recent' OR (state.reference_id IS NOT NULL AND NOT (state.location ? 'recentDismissedAt')))
     ORDER BY ${order}
     LIMIT $5 OFFSET $6`,
    [ownerKey, libraryId, query, view, limit + 1, offset],
  );
  const rows = result.rows.slice(0, limit);
  return Response.json({
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      type: row.type,
      persons: contributorSummary(row.contributors || []) || 'Unknown persons',
      year: Number(row.issued?.year) || null,
      language: row.language || '',
      format: referenceFileType({ source: row.source || {}, artifacts: [{ kind: 'original', mimeType: row.mime_type || '' }] }),
      hasOpenAlex: Boolean(row.has_openalex),
      hasAnnotations: Boolean(row.has_annotations),
      hasText: Boolean(row.has_text),
      hasStructure: Boolean(row.has_structure),
      sizeBytes: Number(row.size_bytes || 0),
      progress: readingProgressPercent(row.location || {}),
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      updatedAt: new Date(row.updated_at).toISOString(),
    })),
    offset,
    hasMore: result.rows.length > limit,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
};
