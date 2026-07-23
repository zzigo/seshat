import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectsCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';
import { assertManagedStorageQuota } from '../../../../lib/user-accounts';

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const allowed = new Set(['pdf', 'docx', 'txt', 'epub', 'webarchive', 'djvu', 'djv']);
const mediaTypes: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  epub: 'application/epub+zip',
  webarchive: 'application/x-webarchive',
  djvu: 'image/vnd.djvu',
  djv: 'image/vnd.djvu',
};
const extension = (name: string) => name.toLowerCase().split('.').pop() || '';
const safeName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'document';
const relativeDirectoryForKey = (key:string,root:string) => {
  const relative=key.startsWith(`${root}/`)?key.slice(root.length+1):key;
  return relative.includes('/')?relative.slice(0,relative.lastIndexOf('/')):'';
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  const reference = await catalog.get(ownerKey, params.id || '');
  if (!reference || reference.access !== 'owner') return Response.json({ error: 'not_found' }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No document received.' }, { status: 400 });
  const ext = extension(file.name);
  if (!allowed.has(ext)) return Response.json({ error: 'Use PDF, DOCX, TXT, EPUB, WEBARCHIVE or DJVU.' }, { status: 415 });
  if (!file.size || file.size > MAX_UPLOAD_BYTES) return Response.json({ error: 'The document must be between 1 byte and 256 MB.' }, { status: 413 });
  const replacedBytes=reference.artifacts.filter(artifact=>artifact.kind==='original'&&artifact.provider!=='wasabi-linked').reduce((sum,artifact)=>sum+artifact.sizeBytes,0);
  try { await assertManagedStorageQuota(ownerKey,file.size,replacedBytes); }
  catch { return Response.json({error:'Your managed storage quota would be exceeded.'},{status:413}); }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const duplicate = await catalog.findBySha256(ownerKey, sha256);
  if (duplicate && duplicate.id !== reference.id) {
    return Response.json({ error: `That file is already attached to “${duplicate.title}”.` }, { status: 409 });
  }

  const bucket = getWasabiBucket();
  const storageRoot = String((reference.source as any).wasabiStorageRoot || process.env.WASABI_KEY_PREFIX || 'zzttuntref');
  const objectKey = `${storageRoot}/.seshat/${reference.id}/original/${Date.now()}-${safeName(file.name)}`;
  const mimeType = file.type || mediaTypes[ext] || 'application/octet-stream';
  const storage = getWasabiClient();
  let uploaded = false;
  try {
    const stored = await storage.send(new PutObjectCommand({
      Bucket: bucket, Key: objectKey, Body: bytes, ContentType: mimeType,
      Metadata: { sha256, 'reference-id': reference.id }, CacheControl: 'private, no-store',
    }));
    uploaded = true;
    const updated = await catalog.replaceOriginal(ownerKey, reference.id, {
      originalFilename: file.name,
      originalSha256: sha256,
      artifact: {
        id: randomUUID(), kind: 'original', provider: 'wasabi', objectKey, bucket, mimeType,
        sizeBytes: file.size, sha256, etag: stored.ETag?.replaceAll('"', ''),
      },
    });
    if (!updated) throw new Error('REFERENCE_NOT_FOUND');
    await catalog.pool.query(
      `UPDATE catalog_references
       SET source=jsonb_set(jsonb_set(source,'{wasabiObjectKey}',to_jsonb($3::text),true),'{wasabiStorageRoot}',to_jsonb($4::text),true)
       WHERE owner_key=$1 AND id=$2`,
      [ownerKey,reference.id,objectKey,storageRoot],
    ).catch((error)=>console.error('[seshat:file:source-path]',error));
    const replaced=reference.artifacts.filter((artifact)=>artifact.kind==='original'&&artifact.objectKey!==objectKey).map((artifact)=>({
      key:artifact.objectKey,
      filename:artifact.objectKey.split('/').at(-1)||artifact.objectKey,
      provider:artifact.provider,
    }));
    const sanitizePaths=[...new Set([...replaced.map((artifact)=>relativeDirectoryForKey(artifact.key,storageRoot)),relativeDirectoryForKey(objectKey,storageRoot)])];
    return Response.json({ ok: true, reference:await catalog.get(ownerKey,reference.id),replaced,sanitizePaths });
  } catch (error: any) {
    if (uploaded) await storage.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Quiet: true, Objects: [{ Key: objectKey }] } })).catch(() => undefined);
    console.error('[seshat:file]', error);
    const conflict = String(error?.code || '') === '23505';
    return Response.json({ error: conflict ? 'That file is already attached to another reference.' : 'The associated file could not be replaced.' }, { status: conflict ? 409 : 500 });
  }
};
