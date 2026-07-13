import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';

const removeKeys = async (bucket: string, keys: string[]): Promise<number> => {
  const unique = [...new Set(keys.filter(Boolean))];
  let removed = 0;
  for (let offset = 0; offset < unique.length; offset += 1000) {
    const batch = unique.slice(offset, offset + 1000);
    const result = await getWasabiClient().send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Quiet: true, Objects: batch.map((Key) => ({ Key })) },
    }));
    const failures = (result.Errors || []).filter((error) => !['NoSuchBucket', 'NoSuchKey', 'NotFound'].includes(String(error.Code || '')));
    if (failures.length) throw new Error(`WASABI_DELETE_FAILED:${failures[0]?.Code || 'unknown'}`);
    removed += batch.length - (result.Errors?.length || 0);
  }
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
    const wasabiBucket = getWasabiBucket();
    for (const artifact of reference.artifacts) {
      if (!['wasabi', 'wasabi-linked'].includes(artifact.provider)) continue;
      const bucket = artifact.bucket || wasabiBucket;
      byBucket.set(bucket, [...(byBucket.get(bucket) || []), artifact.objectKey]);
    }
    let objectsDeleted = 0;
    for (const [bucket, keys] of byBucket) objectsDeleted += await removeKeys(bucket, keys);
    const deleted = await catalog.deleteReference(ownerKey, reference.id);
    if (!deleted) return Response.json({ error: 'not_found' }, { status: 404 });
    return Response.json({ ok: true, id: reference.id, objectsDeleted });
  } catch (error) {
    console.error('[seshat:delete]', error);
    return Response.json({ error: 'The reference and its stored files could not be deleted.' }, { status: 502 });
  }
};
