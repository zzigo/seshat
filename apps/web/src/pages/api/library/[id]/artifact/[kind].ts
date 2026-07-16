import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../../lib/catalog';
import { buildDocumentStructure } from '../../../../../lib/document-structure';
import { getWasabiBucket, getWasabiClient } from '../../../../../lib/wasabi';

const allowed = new Set(['markdown', 'structure', 'chunks', 'docling-json', 'html', 'reader-pdf']);

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '');
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const kind = params.kind || '';
  if (!allowed.has(kind)) return new Response('Not found', { status: 404 });
  const reference = await getCatalog().get(ownerKeyFor(email), params.id || '');
  const artifact = reference?.artifacts.find((item) => item.kind === kind);
  if (!reference || !artifact?.bucket) return new Response('Not found', { status: 404 });
  if (artifact.bucket !== getWasabiBucket()) return Response.json({ error: 'legacy_artifact_not_migrated' }, { status: 409 });
  const object = await getWasabiClient().send(new GetObjectCommand({ Bucket: artifact.bucket, Key: artifact.objectKey }));
  if (!object.Body) return new Response('Not found', { status: 404 });
  if (kind === 'structure') {
    const stored = JSON.parse(await object.Body.transformToString()) as { schemaVersion?: number };
    if (Number(stored.schemaVersion || 1) < 2) {
      const doclingArtifact = reference.artifacts.find((item) => item.kind === 'docling-json');
      if (doclingArtifact?.bucket === getWasabiBucket()) {
        const docling = await getWasabiClient().send(new GetObjectCommand({ Bucket: doclingArtifact.bucket, Key: doclingArtifact.objectKey }));
        if (docling.Body) {
          const enriched = buildDocumentStructure(JSON.parse(await docling.Body.transformToString()));
          return Response.json(enriched, { headers: { 'Cache-Control': 'private, no-store' } });
        }
      }
    }
    return Response.json(stored, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  return new Response(object.Body.transformToWebStream(), { headers: {
    'Content-Type': object.ContentType || artifact.mimeType || 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
  } });
};
