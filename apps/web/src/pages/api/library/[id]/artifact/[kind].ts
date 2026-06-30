import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../../lib/catalog';
import { getR2Client } from '../../../../../lib/r2';

const allowed = new Set(['markdown', 'structure', 'chunks', 'docling-json']);

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '');
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const kind = params.kind || '';
  if (!allowed.has(kind)) return new Response('Not found', { status: 404 });
  const reference = await getCatalog().get(ownerKeyFor(email), params.id || '');
  const artifact = reference?.artifacts.find((item) => item.kind === kind);
  if (!reference || !artifact?.bucket) return new Response('Not found', { status: 404 });
  const object = await getR2Client().send(new GetObjectCommand({ Bucket: artifact.bucket, Key: artifact.objectKey }));
  if (!object.Body) return new Response('Not found', { status: 404 });
  return new Response(object.Body.transformToWebStream(), { headers: {
    'Content-Type': object.ContentType || artifact.mimeType || 'text/plain; charset=utf-8',
    'Cache-Control': 'private, no-store',
  } });
};
