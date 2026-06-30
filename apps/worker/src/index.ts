import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgresCatalog } from '@seshat/catalog';
import { isValidIsbn, normalizeIsbn } from '@seshat/core';

const exec = promisify(execFile);
const catalog = new PostgresCatalog(process.env.DATABASE_URL || '');
const bucket = process.env.R2_BUCKET || '';
const r2 = new S3Client({ region: 'auto', endpoint: process.env.R2_ENDPOINT,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID || '', secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '' } });
const python = process.env.SESHAT_PYTHON || join(process.cwd(), '.venv/bin/python');
const pollMs = Number(process.env.WORKER_POLL_MS || 4000);

type Claimed = { id: string; reference_id: string; stage: 'extract' | 'identify'; attempts: number };

async function claim(): Promise<Claimed | null> {
  await catalog.ensureSchema();
  const result = await catalog.pool.query<Claimed>(`
    WITH candidate AS (
      SELECT id FROM catalog_jobs WHERE status='queued' AND stage IN ('extract','identify')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE catalog_jobs j SET status='running', attempts=attempts+1, updated_at=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.id,j.reference_id,j.stage,j.attempts`);
  return result.rows[0] || null;
}

async function fail(job: Claimed, error: unknown) {
  await catalog.pool.query(`UPDATE catalog_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
    [job.id, String((error as any)?.message || error).slice(0, 2000)]);
}

async function objectBytes(key: string): Promise<Uint8Array> {
  const result = await r2.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`R2 object missing: ${key}`);
  return result.Body.transformToByteArray();
}

async function referenceData(id: string) {
  const [reference, artifacts] = await Promise.all([
    catalog.pool.query('SELECT * FROM catalog_references WHERE id=$1', [id]),
    catalog.pool.query('SELECT * FROM catalog_artifacts WHERE reference_id=$1 ORDER BY created_at', [id]),
  ]);
  if (!reference.rows[0]) throw new Error(`Reference missing: ${id}`);
  return { reference: reference.rows[0], artifacts: artifacts.rows };
}

async function complete(job: Claimed, next: string, payload: unknown = {}) {
  const client = await catalog.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`UPDATE catalog_jobs SET status='complete', payload=$2::jsonb, error=NULL, updated_at=now() WHERE id=$1`, [job.id, JSON.stringify(payload)]);
    await client.query(`UPDATE catalog_jobs SET status='queued', updated_at=now() WHERE reference_id=$1 AND stage=$2 AND status='blocked'`, [job.reference_id, next]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function extract(job: Claimed) {
  const { reference, artifacts } = await referenceData(job.reference_id);
  const original = artifacts.find((item) => item.kind === 'original');
  if (!original) throw new Error('Original artifact missing');
  const root = await mkdtemp(join(tmpdir(), 'seshat-'));
  try {
    const filename = String(reference.source?.originalFilename || `source${extname(original.object_key)}`);
    const source = join(root, basename(filename));
    const output = join(root, 'out');
    await writeFile(source, await objectBytes(original.object_key));
    await exec(python, ['-m', 'seshat_ingest.cli', source, '--reference-id', job.reference_id,
      '--artifact-id', original.id, '--output', output], { env: { ...process.env, PYTHONPATH: join(process.cwd(), 'services/ingest') }, maxBuffer: 10 * 1024 * 1024 });
    const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
    for (const item of manifest.artifacts) {
      const bytes = await readFile(join(output, item.filename));
      const key = `seshat/${reference.owner_key}/${job.reference_id}/derived/docling/${item.filename}`;
      const stored = await r2.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: item.media_type, CacheControl: 'private, no-store' }));
      await catalog.pool.query(`INSERT INTO catalog_artifacts
        (id,reference_id,kind,provider,object_key,bucket,mime_type,size_bytes,sha256,etag)
        VALUES($1,$2,$3,'r2',$4,$5,$6,$7,$8,$9) ON CONFLICT(object_key) DO NOTHING`,
        [randomUUID(), job.reference_id, item.kind, key, bucket, item.media_type, item.size_bytes, item.sha256, stored.ETag?.replaceAll('"','')]);
    }
    await complete(job, 'identify', { parser: manifest.parser, sourceSha256: manifest.source_sha256 });
  } finally { await rm(root, { recursive: true, force: true }); }
}

function explicitIsbns(text: string): string[] {
  const candidates = text.match(/(?:ISBN(?:-1[03])?[:\s]*)?(?:97[89][\s-]?)?\d[\dXx\s-]{8,20}/g) || [];
  return [...new Set(candidates.map(normalizeIsbn).filter((value): value is string => Boolean(value && isValidIsbn(value))))];
}

async function googleBooks(query: string): Promise<any[]> {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', query); url.searchParams.set('maxResults', '5'); url.searchParams.set('printType', 'books');
  if (process.env.GOOGLE_API_KEY) url.searchParams.set('key', process.env.GOOGLE_API_KEY);
  let response = await fetch(url);
  if (response.status === 403 && url.searchParams.has('key')) {
    url.searchParams.delete('key');
    response = await fetch(url);
  }
  if (!response.ok) throw new Error(`Google Books ${response.status}`);
  return (await response.json()).items || [];
}

async function openLibrary(input: { isbn?: string; title?: string; authors?: string[] }): Promise<any[]> {
  const url = new URL('https://openlibrary.org/search.json');
  if (input.isbn) url.searchParams.set('isbn', input.isbn);
  else {
    url.searchParams.set('title', input.title || '');
    if (input.authors?.[0]) url.searchParams.set('author', input.authors[0]);
  }
  url.searchParams.set('limit', '5');
  url.searchParams.set('fields', 'key,title,author_name,first_publish_year,isbn,language');
  const response = await fetch(url, { headers: { 'User-Agent': 'Seshat/0.1 (https://seshat.zztt.org)' } });
  if (!response.ok) throw new Error(`Open Library ${response.status}`);
  return ((await response.json()).docs || []).map((doc:any) => ({ id: doc.key, provider: 'open-library', volumeInfo: {
    title: doc.title, authors: doc.author_name || [], publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    industryIdentifiers: (doc.isbn || []).map((identifier:string) => ({ type: identifier.length === 13 ? 'ISBN_13' : 'ISBN_10', identifier })),
    language: doc.language?.[0],
  }}));
}

async function ollamaCandidate(text: string): Promise<{title:string;authors:string[];year:number|null;confidence:number}> {
  const format = { type:'object', properties:{ title:{type:'string'}, authors:{type:'array',items:{type:'string'}}, year:{type:['integer','null']}, confidence:{type:'number'} }, required:['title','authors','year','confidence'] };
  const response = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/chat`, { method:'POST', headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(60_000), body:JSON.stringify({
    model: process.env.OLLAMA_MODEL || 'qwen3:1.7b', stream:false, think:false, format, options:{temperature:0,num_predict:128,num_ctx:4096},
    messages:[{role:'system',content:'Extract bibliographic search terms only from the supplied document evidence. Never invent an ISBN.'},{role:'user',content:text.slice(0,3000)+'\n\n[END]\n'+text.slice(-1000)}]
  }) });
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  return JSON.parse((await response.json()).message.content);
}

async function identify(job: Claimed) {
  const { reference, artifacts } = await referenceData(job.reference_id);
  const markdown = artifacts.find((item) => item.kind === 'markdown');
  if (!markdown) throw new Error('Markdown derivative missing');
  const text = new TextDecoder().decode(await objectBytes(markdown.object_key));
  const explicit = explicitIsbns(text);
  let items: any[] = [];
  for (const isbn of explicit) {
    try { items = await googleBooks(`isbn:${isbn}`); }
    catch { items = await openLibrary({ isbn }); }
    if (!items.length) items = await openLibrary({ isbn });
    if (items.length) break;
  }
  let inference: any = null;
  if (!items.length) {
    inference = await ollamaCandidate(text);
    const query = [`intitle:${inference.title}`, ...(inference.authors || []).slice(0,2).map((a:string)=>`inauthor:${a}`)].join(' ');
    try { items = await googleBooks(query); }
    catch { items = await openLibrary({ title: inference.title, authors: inference.authors }); }
    if (!items.length) items = await openLibrary({ title: inference.title, authors: inference.authors });
  }
  const volume = items[0]?.volumeInfo;
  if (!volume) { await complete(job, 'summarize', { status:'unresolved', explicit }); return; }
  const isbns = (volume.industryIdentifiers || []).map((item:any)=>normalizeIsbn(item.identifier)).filter((value:any)=>value && isValidIsbn(value));
  await catalog.pool.query(`UPDATE catalog_references SET title=$2, contributors=$3::jsonb, issued=$4::jsonb,
    identifiers=$5::jsonb, language=COALESCE($6,language), source=source || $7::jsonb, updated_at=now() WHERE id=$1`,
    [job.reference_id, volume.title || reference.title, JSON.stringify((volume.authors || []).map((literal:string)=>({literal,role:'author'}))),
      JSON.stringify(volume.publishedDate ? {year:Number(String(volume.publishedDate).slice(0,4))||undefined} : null),
      JSON.stringify({isbn:isbns}), volume.language || null, JSON.stringify({identification:{provider:items[0].provider || 'google-books',volumeId:items[0].id,inference}})]);
  await complete(job, 'summarize', { provider:items[0].provider || 'google-books', volumeId:items[0].id, explicit });
}

async function tick() {
  const job = await claim(); if (!job) return;
  try { if (job.stage === 'extract') await extract(job); else await identify(job); }
  catch (error) { console.error(`[worker:${job.stage}]`, error); await fail(job, error); }
}

async function run() {
  try { await tick(); }
  catch (error) { console.error('[worker:loop]', error); }
  setTimeout(() => void run(), pollMs);
}

await catalog.ensureSchema();
await catalog.pool.query(`UPDATE catalog_jobs SET status='queued', error='worker restart recovery', updated_at=now() WHERE status='running'`);
console.log(`[seshat-worker] online concurrency=1 model=${process.env.OLLAMA_MODEL || 'qwen3:1.7b'}`);
void run();
