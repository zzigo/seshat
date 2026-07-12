import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';

export const GET: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '');
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const reference = await getCatalog().get(ownerKeyFor(email), params.id || '');
  const artifact = reference?.artifacts.find((item) => item.kind === 'original');
  if (!reference || !artifact?.bucket || !artifact.objectKey) return new Response('Not found', { status: 404 });
  if (artifact.bucket !== getWasabiBucket()) return Response.json({ error: 'legacy_artifact_not_migrated' }, { status: 409 });
  const object = await getWasabiClient().send(new GetObjectCommand({ Bucket: artifact.bucket, Key: artifact.objectKey }));
  if (!object.Body) return new Response('Not found', { status: 404 });
  const filename = String((reference.source as any).originalFilename || reference.title).replace(/["\r\n]/g, '');
  const asciiFilename = filename.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_').replace(/[\\;]/g, '_');
  const encodedFilename = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(object.Body.transformToWebStream(), {
    headers: {
      'Content-Type': object.ContentType || artifact.mimeType || 'application/octet-stream',
      'Content-Length': String(object.ContentLength || artifact.sizeBytes),
      'Content-Disposition': `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      'Cache-Control': 'private, no-store',
    },
  });
};
