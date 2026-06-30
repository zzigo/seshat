import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { getR2Bucket, getR2Client } from '../../../../lib/r2';

const removeKeys = async (bucket: string, keys: string[]): Promise<number> => {
  const unique = [...new Set(keys.filter(Boolean))];
  let removed = 0;
  for (let offset = 0; offset < unique.length; offset += 1000) {
    const batch = unique.slice(offset, offset + 1000);
    const result = await getR2Client().send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Quiet: true, Objects: batch.map((Key) => ({ Key })) },
    }));
    if (result.Errors?.length) throw new Error(`R2_DELETE_FAILED:${result.Errors[0]?.Code || 'unknown'}`);
    removed += batch.length;
  }
  return removed;
};

const removePrefix = async (bucket: string, prefix: string): Promise<number> => {
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await getR2Client().send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    removed += await removeKeys(bucket, (page.Contents || []).map((item) => item.Key || ''));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  const reference = await catalog.get(ownerKey, params.id || '');
  if (!reference) return Response.json({ error: 'not_found' }, { status: 404 });

  try {
    await catalog.cancelJobsForDeletion(ownerKey, reference.id);
    const byBucket = new Map<string, string[]>();
    for (const artifact of reference.artifacts) {
      const bucket = artifact.bucket || getR2Bucket();
      byBucket.set(bucket, [...(byBucket.get(bucket) || []), artifact.objectKey]);
    }
    let objectsDeleted = 0;
    for (const [bucket, keys] of byBucket) objectsDeleted += await removeKeys(bucket, keys);
    objectsDeleted += await removePrefix(getR2Bucket(), `seshat/${ownerKey}/${reference.id}/`);
    const deleted = await catalog.deleteReference(ownerKey, reference.id);
    if (!deleted) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ ok: true, id: reference.id, objectsDeleted });
  } catch (error) {
    console.error('[seshat:delete]', error);
    return Response.json({ error: 'The reference and its stored files could not be deleted.' }, { status: 502 });
  }
};
