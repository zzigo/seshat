import { createHash, randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { generateCiteKey } from '@seshat/core';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { storageRootFor } from '../../../lib/bibliography-paths';
import { getWasabiBucket, getWasabiClient } from '../../../lib/wasabi';
import { assertManagedStorageQuota } from '../../../lib/user-accounts';

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const allowed = new Set(['pdf', 'docx', 'txt', 'epub']);
const mediaTypes: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain; charset=utf-8',
  epub: 'application/epub+zip',
};

const extension = (name: string) => name.toLowerCase().split('.').pop() || '';
const safeName = (name: string): string => name
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'document';
const titleFromName = (name: string): string => name
  .replace(/\.[a-z0-9]+$/i, '')
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim() || 'Untitled document';

export const POST: APIRoute = async ({ request, locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return Response.json({ error: 'No document received.' }, { status: 400 });
  const ext = extension(file.name);
  if (!allowed.has(ext)) return Response.json({ error: 'Use PDF, DOCX, TXT or EPUB.' }, { status: 415 });
  if (!file.size || file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ error: 'The document must be between 1 byte and 256 MB.' }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  try { await assertManagedStorageQuota(ownerKey,file.size); }
  catch { return Response.json({error:'Your managed storage quota would be exceeded.'},{status:413}); }
  const duplicate = await catalog.findBySha256(ownerKey, sha256);
  if (duplicate) {
    await catalog.addToLibrary(ownerKey, duplicate.id, String(form?.get('libraryId') || '') || undefined);
    return Response.json({ ok: true, duplicate: true, reference: duplicate });
  }

  const referenceId = randomUUID();
  const artifactId = randomUUID();
  const title = titleFromName(file.name);
  const mimeType = file.type || mediaTypes[ext] || 'application/octet-stream';
  const storageRoot = storageRootFor({ email, name: String((locals.session as any)?.user?.name || '') }).root;
  const objectKey = `${storageRoot}/.seshat/${referenceId}/original/${safeName(file.name)}`;
  const bucket = getWasabiBucket();
  const storage = getWasabiClient();
  let uploaded = false;

  try {
    const stored = await storage.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: mimeType,
      Metadata: { sha256, 'reference-id': referenceId },
      CacheControl: 'private, no-store',
    }));
    uploaded = true;
    const reference = await catalog.catalogDocument({
      id: referenceId,
      ownerKey,
      citeKey: generateCiteKey({ title }),
      title,
      originalSha256: sha256,
      libraryId: String(form?.get('libraryId') || '') || undefined,
      source: {
        provider: 'upload',
        itemKey: referenceId,
        importedAt: new Date().toISOString(),
        originalFilename: file.name,
        wasabiStorageRoot: storageRoot,
      },
      artifact: {
        id: artifactId,
        kind: 'original',
        provider: 'wasabi',
        objectKey,
        bucket,
        mimeType,
        sizeBytes: file.size,
        sha256,
        etag: stored.ETag?.replaceAll('"', ''),
      },
    });
    return Response.json({ ok: true, duplicate: false, reference }, { status: 201 });
  } catch (error: any) {
    if (uploaded) await storage.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey })).catch(() => undefined);
    console.error('[seshat:intake]', error);
    const configuration = String(error?.message || '').includes('NOT_CONFIGURED');
    return Response.json(
      { error: configuration ? 'Storage or catalog is not configured.' : 'The document could not be catalogued.' },
      { status: configuration ? 503 : 500 },
    );
  }
};
