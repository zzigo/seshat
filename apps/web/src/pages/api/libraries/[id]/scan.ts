import { createHash, randomUUID } from 'node:crypto';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { generateCiteKey } from '@seshat/core';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { storageRootFor } from '../../../../lib/bibliography-paths';
import { getWasabiBucket, getWasabiClient } from '../../../../lib/wasabi';

const supported = new Set(['pdf','docx','txt','epub','webarchive','djvu','djv']);
const extension = (name: string) => name.toLowerCase().split('.').pop() || '';
const filenameFor = (key: string) => key.split('/').filter(Boolean).at(-1) || key;
const titleFor = (filename: string) => filename.replace(/\.[a-z0-9]+$/i,'').replace(/[_-]+/g,' ').replace(/\s+/g,' ').trim() || 'Untitled document';
const mimeFor = (filename: string) => ({ pdf:'application/pdf', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt:'text/plain; charset=utf-8', epub:'application/epub+zip', webarchive:'application/x-webarchive', djvu:'image/vnd.djvu', djv:'image/vnd.djvu' } as Record<string,string>)[extension(filename)] || 'application/octet-stream';

const folderContext = async (locals: App.Locals, libraryId: string) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const ownerKey = ownerKeyFor(email); const catalog = getCatalog(); await catalog.ensureSchema();
  const result = await catalog.pool.query(`WITH RECURSIVE branch AS (
    SELECT id,name,parent_id,0 AS depth FROM catalog_libraries WHERE id=$1 AND owner_key=$2
    UNION ALL SELECT parent.id,parent.name,parent.parent_id,branch.depth+1
      FROM catalog_libraries parent JOIN branch ON branch.parent_id=parent.id WHERE parent.owner_key=$2
  ) SELECT id,name,parent_id,depth FROM branch ORDER BY depth DESC`, [libraryId,ownerKey]);
  if (!result.rows.length || result.rows.some((row:any) => String(row.id).startsWith('inbox:'))) return null;
  const names = result.rows.map((row:any) => String(row.name).normalize('NFC').replaceAll('/','-').trim()).filter(Boolean);
  const root = storageRootFor({ email, name:String((locals.session as any)?.user?.name || '') }).root;
  return { email,ownerKey,catalog,root,prefix:`${root}/${names.join('/')}/` };
};

const scan = async (context: NonNullable<Awaited<ReturnType<typeof folderContext>>>) => {
  const bucket = getWasabiBucket(); const storage = getWasabiClient(); const objects:any[] = []; let token: string | undefined;
  do {
    const page = await storage.send(new ListObjectsV2Command({ Bucket:bucket,Prefix:context.prefix,ContinuationToken:token,MaxKeys:1000 }));
    objects.push(...(page.Contents || [])); token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token && objects.length < 5000);
  const linked = await context.catalog.pool.query(`SELECT a.object_key FROM catalog_artifacts a JOIN catalog_references r ON r.id=a.reference_id WHERE r.owner_key=$1 AND a.kind='original'`,[context.ownerKey]);
  const linkedKeys = new Set(linked.rows.map((row:any) => String(row.object_key)));
  const candidates = objects.filter((object:any) => object.Key && Number(object.Size || 0) > 0 && supported.has(extension(object.Key)) && !object.Key.includes('/.seshat/') && !linkedKeys.has(object.Key)).map((object:any) => ({
    key:String(object.Key), filename:filenameFor(String(object.Key)), sizeBytes:Number(object.Size || 0), etag:String(object.ETag || '').replaceAll('"',''), modifiedAt:object.LastModified?.toISOString?.() || null,
  }));
  return { bucket,candidates,inspected:objects.length,truncated:Boolean(token) };
};

export const GET: APIRoute = async ({ locals,params }) => {
  const context = await folderContext(locals,params.id || '');
  if (!context) return Response.json({ error:'Folder not found or cannot be scanned.' },{ status:String((locals.session as any)?.user?.email || '') ? 404 : 401 });
  const result = await scan(context);
  return Response.json({ prefix:context.prefix,...result });
};

export const POST: APIRoute = async ({ locals,params }) => {
  const context = await folderContext(locals,params.id || '');
  if (!context) return Response.json({ error:'Folder not found or cannot be scanned.' },{ status:String((locals.session as any)?.user?.email || '') ? 404 : 401 });
  const result = await scan(context); const imported = []; const errors = [];
  for (const candidate of result.candidates.slice(0,200)) {
    const id=randomUUID(); const title=titleFor(candidate.filename); const sha256=createHash('sha256').update(['wasabi-folder',result.bucket,candidate.key,candidate.etag,candidate.sizeBytes].join('\0')).digest('hex');
    try {
      const reference=await context.catalog.catalogDocument({ id,ownerKey:context.ownerKey,citeKey:generateCiteKey({title}),title,originalSha256:sha256,libraryId:params.id || '',source:{ provider:'wasabi-folder-scan',itemKey:id,importedAt:new Date().toISOString(),originalFilename:candidate.filename,wasabiObjectKey:candidate.key,wasabiStorageRoot:context.root },artifact:{ id:randomUUID(),kind:'original',provider:'wasabi-linked',objectKey:candidate.key,bucket:result.bucket,mimeType:mimeFor(candidate.filename),sizeBytes:candidate.sizeBytes,sha256,etag:candidate.etag } });
      imported.push(reference);
    } catch (error:any) { errors.push({ key:candidate.key,error:String(error?.code || error?.message || 'import_failed') }); }
  }
  return Response.json({ ok:true,prefix:context.prefix,inspected:result.inspected,imported,errors },{ status:201 });
};
