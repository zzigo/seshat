import { createHash, randomUUID } from 'node:crypto';
import { HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { mapBibAttachment, storageRootFor } from '../../../../lib/bibliography-paths';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';

const supported = /\.(pdf|epub|docx|txt)$/i;
const mimeType = (filename: string): string => filename.toLowerCase().endsWith('.pdf') ? 'application/pdf'
  : filename.toLowerCase().endsWith('.epub') ? 'application/epub+zip'
  : filename.toLowerCase().endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  : 'text/plain; charset=utf-8';
const normalized = (value: unknown): string => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stopwords = new Set(['and','the','for','from','with','como','para','las','los','una','uno','del','por','con','y']);
const tokens = (value: unknown): Set<string> => new Set(normalized(value).split(' ').filter((token) => token.length > 2 && !stopwords.has(token)));

const context = async (locals: App.Locals, id: string) => {
  const user = (locals.session as any)?.user; const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const ownerKey = ownerKeyFor(email); const catalog = getCatalog(); const reference = await catalog.get(ownerKey, id);
  return reference?.access === 'owner' ? { user, email, ownerKey, catalog, reference } : null;
};

export const GET: APIRoute = async ({ locals, params }) => {
  const value = await context(locals, params.id || '');
  if (!value) return Response.json({ error:'not_found' }, { status:404 });
  const identity = { email:value.email, name:String(value.user?.name || '') };
  const root = storageRootFor(identity).root;
  const mapped = mapBibAttachment((value.reference.source as any)?.bibtex?.file, identity);
  const expectedDirectory = mapped?.objectKey.includes('/') ? mapped.objectKey.slice(0, mapped.objectKey.lastIndexOf('/') + 1) : `${root}/`;
  const searchPrefix = `${root}/`;
  const storage = getWasabiClient(); const bucket = getWasabiBucket(); const objects: Array<{ Key?:string; Size?:number; LastModified?:Date }> = [];
  if (mapped) {
    try {
      const exact = await storage.send(new HeadObjectCommand({ Bucket:bucket, Key:mapped.objectKey }));
      objects.push({ Key:mapped.objectKey, Size:Number(exact.ContentLength || 0), LastModified:exact.LastModified });
    } catch { /* the mapped BibTeX path is only a hint */ }
  }
  const collect = async (prefix: string, maximumPages: number) => {
    let token: string | undefined;
    for (let page = 0; page < maximumPages; page += 1) {
      const result = await storage.send(new ListObjectsV2Command({ Bucket:bucket, Prefix:prefix, ContinuationToken:token, MaxKeys:1000 }));
      objects.push(...(result.Contents || [])); token = result.NextContinuationToken; if (!token) break;
    }
  };
  if (expectedDirectory.startsWith(`${root}/`)) await collect(expectedDirectory, 20);
  if (expectedDirectory !== searchPrefix) await collect(searchPrefix, 5);
  const titleTokens = tokens(value.reference.title);
  const creatorTokens = tokens((value.reference.contributors || []).map((person:any) => person.family || person.literal || '').join(' '));
  const year = String((value.reference.issued as any)?.year || ''); const expectedName = normalized(mapped?.filename || '');
  const seen = new Set<string>();
  const candidates = objects.flatMap((object) => {
    const key = String(object.Key || ''); const filename = key.split('/').at(-1) || ''; if (!supported.test(filename) || key.includes('/.seshat/')) return [];
    if (seen.has(key)) return []; seen.add(key);
    const name = normalized(filename); const nameTokens = tokens(filename);
    const exact = Boolean(expectedName && name === expectedName); let score = exact ? 100 : 0; let titleHits = 0; let creatorHits = 0;
    for (const token of titleTokens) if (nameTokens.has(token)) { score += 5; titleHits += 1; }
    for (const token of creatorTokens) if (nameTokens.has(token)) { score += 7; creatorHits += 1; }
    const titleCoverage = titleTokens.size ? titleHits / titleTokens.size : 0;
    const creatorCoverage = creatorTokens.size ? creatorHits / creatorTokens.size : 0;
    score += Math.round(titleCoverage * 60 + creatorCoverage * 20);
    if (!exact && titleCoverage < .28 && !(titleHits >= 1 && creatorHits >= 1)) return [];
    if (year && name.includes(year)) score += 12;
    if (mapped && key.startsWith(expectedDirectory)) score += 8;
    if (!score) return [];
    return [{ key, filename, path:key.slice(root.length + 1), sizeBytes:Number(object.Size || 0), lastModified:object.LastModified?.toISOString(), score }];
  }).sort((a,b) => b.score - a.score || a.filename.localeCompare(b.filename)).slice(0,25);
  return Response.json({ candidates, expected:mapped?.relativePath || null, scanned:objects.length });
};

export const POST: APIRoute = async ({ request, locals, params }) => {
  const value = await context(locals, params.id || '');
  if (!value) return Response.json({ error:'not_found' }, { status:404 });
  const body = await request.json().catch(() => null) as { key?:unknown } | null; const key = String(body?.key || '');
  const root = storageRootFor({ email:value.email, name:String(value.user?.name || '') }).root;
  if (!key.startsWith(`${root}/`) || key.includes('/.seshat/') || !supported.test(key)) return Response.json({ error:'invalid_candidate' }, { status:400 });
  const occupied = await value.catalog.pool.query(
    `SELECT r.title FROM catalog_artifacts a JOIN catalog_references r ON r.id=a.reference_id
     WHERE a.object_key=$1 AND a.kind='original' AND r.id<>$2 LIMIT 1`, [key, value.reference.id]);
  if (occupied.rows[0]) return Response.json({ error:`Already linked to “${occupied.rows[0].title}”.` }, { status:409 });
  const bucket = getWasabiBucket(); const head = await getWasabiClient().send(new HeadObjectCommand({ Bucket:bucket, Key:key }));
  const filename = key.split('/').at(-1) || 'document';
  const sha256 = /^[a-f0-9]{64}$/i.test(String(head.Metadata?.sha256 || '')) ? String(head.Metadata!.sha256).toLowerCase()
    : createHash('sha256').update(['wasabi',bucket,key,head.ETag || '',head.ContentLength || 0].join('\0')).digest('hex');
  const updated = await value.catalog.replaceOriginal(value.ownerKey, value.reference.id, {
    originalFilename:filename, originalSha256:sha256,
    artifact:{ id:randomUUID(), kind:'original', provider:'wasabi-linked', objectKey:key, bucket,
      mimeType:head.ContentType || mimeType(filename), sizeBytes:Number(head.ContentLength || 0), sha256, etag:head.ETag?.replaceAll('"','') },
  });
  if (!updated) return Response.json({ error:'not_found' }, { status:404 });
  await value.catalog.pool.query(
    `UPDATE catalog_references SET source=jsonb_set(jsonb_set(source,'{wasabiObjectKey}',to_jsonb($3::text),true),'{wasabiStorageRoot}',to_jsonb($4::text),true) WHERE owner_key=$1 AND id=$2`,
    [value.ownerKey,value.reference.id,key,root]);
  return Response.json({ ok:true, reference:await value.catalog.get(value.ownerKey,value.reference.id) });
};
