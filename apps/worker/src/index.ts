import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgresCatalog, persistResolution, rebuildScholarlyGraph } from '@seshat/catalog';
import { OpenAlexClient, extractScholarlyMetadataFromText, isValidIsbn, normalizeContributor, normalizeIsbn, normalizeScholarlyTitle, zoteroStyleAttachmentName } from '@seshat/core';
import { Neo4jGraphMirror, OllamaEmbedder, QdrantVectorIndex, normalizeDoclingChunk, computeSparseVector } from '@seshat/retrieval';
import { PdfJsScholarlyExtractor } from './scholarly-pdf.js';

const exec = promisify(execFile);
const catalog = new PostgresCatalog(process.env.DATABASE_URL || '');
const bucket = process.env.WASABI_BUCKET || 'untref-licmusica';
const wasabiEndpoint = process.env.WASABI_ENDPOINT || 'https://s3.us-east-2.wasabisys.com';
const storage = new S3Client({ region: process.env.WASABI_REGION || 'us-east-2', endpoint: /^https?:\/\//i.test(wasabiEndpoint) ? wasabiEndpoint : `https://${wasabiEndpoint}`,
  credentials: { accessKeyId: process.env.WASABI_ACCESS_KEY_ID || '', secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY || '' } });
const python = process.env.SESHAT_PYTHON || join(process.cwd(), '.venv/bin/python');
const pollMs = Number(process.env.WORKER_POLL_MS || 4000);
const embedder = new OllamaEmbedder();
const vectorIndex = new QdrantVectorIndex();
const graphMirror = new Neo4jGraphMirror();
const scholarlyExtractor = new PdfJsScholarlyExtractor();
const openAlex = new OpenAlexClient({baseUrl:process.env.OPENALEX_API_BASE_URL,mailto:process.env.OPENALEX_MAILTO,apiKey:process.env.OPENALEX_API_KEY,timeoutMs:Number(process.env.OPENALEX_TIMEOUT_MS||12000),retries:Number(process.env.OPENALEX_RETRIES||3),cacheTtlDays:Number(process.env.OPENALEX_CACHE_TTL_DAYS||30),cache:{get:(key)=>catalog.getOpenAlexCache(key),set:(key,value,expiresAt)=>catalog.setOpenAlexCache(key,value,expiresAt)}});
const copySegment = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

type Claimed = { id: string; reference_id: string; stage: 'extract' | 'scholarly' | 'identify' | 'summarize' | 'relate'; attempts: number };

async function claim(): Promise<Claimed | null> {
  await catalog.ensureSchema();
  const result = await catalog.pool.query<Claimed>(`
    WITH candidate AS (
      SELECT id FROM catalog_jobs WHERE status='queued' AND stage IN ('extract','scholarly','identify','summarize','relate')
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE catalog_jobs j SET status='running', attempts=attempts+1, updated_at=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.id,j.reference_id,j.stage,j.attempts`);
  return result.rows[0] || null;
}

async function fail(job: Claimed, error: unknown) {
  await catalog.pool.query(`UPDATE catalog_jobs SET status='failed', error=$2, updated_at=now() WHERE id=$1`,
    [job.id, String((error as any)?.message || error).slice(0, 2000)]);
}

async function assertJobRunning(job: Claimed) {
  const result = await catalog.pool.query('SELECT status FROM catalog_jobs WHERE id=$1', [job.id]);
  if (result.rows[0]?.status !== 'running') throw new Error('JOB_CANCELLED');
}

async function objectBytes(key: string): Promise<Uint8Array> {
  const result = await storage.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!result.Body) throw new Error(`Wasabi object missing: ${key}`);
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

async function renameWasabiOriginal(reference: any, next: { title: string; contributors: unknown[]; issued?: Record<string, unknown> | null }) {
  const result = await catalog.pool.query(
    `SELECT * FROM catalog_artifacts WHERE reference_id=$1 AND kind='original' AND provider IN ('wasabi','wasabi-linked') ORDER BY created_at LIMIT 1`,
    [reference.id],
  );
  const artifact = result.rows[0];
  if (!artifact?.bucket || !artifact?.object_key) return;
  const currentFilename = String(reference.source?.originalFilename || artifact.object_key.split('/').at(-1) || 'document');
  const filename = zoteroStyleAttachmentName({ contributors: next.contributors, issued: next.issued || undefined, title: next.title, currentFilename });
  const directory = artifact.object_key.includes('/') ? artifact.object_key.slice(0, artifact.object_key.lastIndexOf('/') + 1) : '';
  const nextKey = `${directory}${filename}`;
  if (nextKey === artifact.object_key) return;
  const copySource = `${copySegment(artifact.bucket)}/${artifact.object_key.split('/').map(copySegment).join('/')}`;
  let copied = false;
  let catalogLinked = false;
  try {
    try {
      await storage.send(new HeadObjectCommand({ Bucket: artifact.bucket, Key: nextKey }));
      throw new Error('TARGET_ALREADY_EXISTS');
    } catch (error: any) {
      if (String(error?.message || '') === 'TARGET_ALREADY_EXISTS') throw error;
      if (Number(error?.$metadata?.httpStatusCode) !== 404 && !['NotFound', 'NoSuchKey'].includes(String(error?.name || ''))) throw error;
    }
    const moved = await storage.send(new CopyObjectCommand({ Bucket: artifact.bucket, Key: nextKey, CopySource: copySource, MetadataDirective: 'COPY' }));
    copied = true;
    const verified = await storage.send(new HeadObjectCommand({ Bucket: artifact.bucket, Key: nextKey }));
    if (Number(verified.ContentLength || 0) !== Number(artifact.size_bytes)) throw new Error('COPIED_SIZE_MISMATCH');
    catalogLinked = await catalog.renameArtifact(reference.owner_key, reference.id, artifact.id, nextKey, filename, moved.CopyObjectResult?.ETag?.replaceAll('"', ''));
    if (!catalogLinked) throw new Error('ARTIFACT_LINK_UPDATE_FAILED');
    await storage.send(new DeleteObjectCommand({ Bucket: artifact.bucket, Key: artifact.object_key }))
      .catch((error) => console.error('[seshat:worker:wasabi-old-object-cleanup]', error));
  } catch (error) {
    if (copied && !catalogLinked) await storage.send(new DeleteObjectCommand({ Bucket: artifact.bucket, Key: nextKey })).catch(() => undefined);
    console.error('[seshat:worker:wasabi-rename]', reference.id, error);
  }
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
    const originalBytes=await objectBytes(original.object_key); await writeFile(source,originalBytes);
    const runIngest = async (ocr = false) => exec(python, ['-m', 'seshat_ingest.cli', source, '--reference-id', job.reference_id,
      '--artifact-id', original.id, '--output', output, ...(ocr ? ['--ocr'] : [])],
      { env: { ...process.env, PYTHONPATH: join(process.cwd(), 'services/ingest') }, maxBuffer: 10 * 1024 * 1024 });
    const readExtraction = async () => ({
      manifest: JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8')),
      chunkRows: (await readFile(join(output, 'chunks.jsonl'), 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)),
      markdown: await readFile(join(output, 'document.md'), 'utf8'),
    });
    await runIngest();
    let extraction = await readExtraction();
    const initialWords = (extraction.markdown.match(/\p{L}[\p{L}\p{N}'’\-]*/gu) || []).length;
    if (extname(filename).toLowerCase() === '.pdf' && initialWords < 20) {
      await rm(output, { recursive: true, force: true });
      await runIngest(true);
      extraction = await readExtraction();
    }
    const { manifest, chunkRows } = extraction;
    const chunks = chunkRows.map((row, index) => normalizeDoclingChunk(job.reference_id, index, row))
      .filter((chunk): chunk is NonNullable<typeof chunk> => Boolean(chunk));
    let wordCount = 0;
    for (const item of manifest.artifacts) {
      await assertJobRunning(job);
      const bytes = await readFile(join(output, item.filename));
      if (item.kind === 'markdown') wordCount = (new TextDecoder().decode(bytes).match(/\p{L}[\p{L}\p{N}'’\-]*/gu) || []).length;
      const storageRoot = String(reference.source?.wasabiStorageRoot || `${process.env.WASABI_KEY_PREFIX || 'zzttuntref'}/seshat-derived/${reference.owner_key}`).replace(/\/+$/g, '');
      const key = `${storageRoot}/.seshat/${job.reference_id}/derived/docling/${item.filename}`;
      const stored = await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: item.media_type, CacheControl: 'private, no-store' }));
      await catalog.pool.query(`INSERT INTO catalog_artifacts
        (id,reference_id,kind,provider,object_key,bucket,mime_type,size_bytes,sha256,etag)
        VALUES($1,$2,$3,'wasabi',$4,$5,$6,$7,$8,$9) ON CONFLICT(object_key) DO NOTHING`,
        [randomUUID(), job.reference_id, item.kind, key, bucket, item.media_type, item.size_bytes, item.sha256, stored.ETag?.replaceAll('"','')]);
    }
    await catalog.replaceChunks(job.reference_id, reference.owner_key, chunks);
    if (extname(filename).toLowerCase()==='.pdf') {
      let pdfMetadata:any={}; try { const buffer=originalBytes.buffer.slice(originalBytes.byteOffset,originalBytes.byteOffset+originalBytes.byteLength) as ArrayBuffer; pdfMetadata=await scholarlyExtractor.extract(buffer); } catch(error){console.warn('[seshat:scholarly-pdf-extraction]',job.reference_id,error);}
      const extracted=extractScholarlyMetadataFromText(extraction.markdown,{title:pdfMetadata.title,authors:pdfMetadata.authors,doi:pdfMetadata.doi,publicationYear:pdfMetadata.publicationYear}); if((pdfMetadata.references?.length||0)>extracted.references.length)extracted.references=pdfMetadata.references;
      await catalog.upsertPaperExtraction(reference.owner_key,job.reference_id,{fileHash:manifest.source_sha256,normalizedTitle:normalizeScholarlyTitle(extracted.title||reference.title),metadata:{title:extracted.title,authors:extracted.authors,abstract:extracted.abstract,doi:extracted.doi,publicationYear:extracted.publicationYear,journal:extracted.journal,provenance:extracted.provenance},references:extracted.references,doi:extracted.doi,provenance:{extraction:{source:'local-extraction',method:'pdfjs+docling-markdown',generatedAt:new Date().toISOString(),confidence:extracted.provenance}}});
    }
    await catalog.pool.query('UPDATE catalog_references SET word_count=$2,updated_at=now() WHERE id=$1', [job.reference_id, wordCount]);
    await complete(job, 'scholarly', { parser: manifest.parser, sourceSha256: manifest.source_sha256, wordCount, chunks: chunks.length, ocr: Boolean(manifest.ocr) });
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function completeScholarly(job:Claimed,payload:Record<string,unknown>){const client=await catalog.pool.connect();try{await client.query('BEGIN');await client.query(`UPDATE catalog_jobs SET status='complete',payload=$2::jsonb,error=NULL,updated_at=now() WHERE id=$1`,[job.id,JSON.stringify(payload)]);await client.query(`UPDATE catalog_jobs SET status='complete',payload=$2::jsonb,error=NULL,updated_at=now() WHERE reference_id=$1 AND stage IN ('identify','summarize','relate') AND status IN ('blocked','queued')`,[job.reference_id,JSON.stringify({skipped:'deterministic-scholarly-pipeline',generatedAt:new Date().toISOString()})]);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}

async function scholarly(job:Claimed){const paper=await catalog.pool.query(`SELECT paper.*,reference.title,reference.contributors,reference.issued,reference.identifiers FROM catalog_papers paper JOIN catalog_references reference ON reference.id=paper.reference_id WHERE paper.reference_id=$1`,[job.reference_id]);const row=paper.rows[0];if(!row){await complete(job,'identify',{status:'not-a-pdf'});return;}const metadata=row.extracted_metadata||{};if(!openAlex.configured){await catalog.savePaperResolution(row.owner_key,job.reference_id,{status:'unresolved',method:'none',confidence:0,candidates:[],provenance:{openalex:{status:'configuration-required',generatedAt:new Date().toISOString()}}});await completeScholarly(job,{status:'unresolved',reason:'OPENALEX_API_KEY_REQUIRED'});return;}const resolution=await openAlex.resolve({doi:row.doi||metadata.doi,openAlexId:metadata.openAlexId,title:metadata.title||row.title,publicationYear:Number(metadata.publicationYear)||undefined,authors:Array.isArray(metadata.authors)?metadata.authors:[]});const saved=await persistResolution(catalog,row.owner_key,job.reference_id,resolution,undefined,openAlex);await completeScholarly(job,{status:saved?.resolutionStatus||resolution.status,method:resolution.method,confidence:resolution.confidence,candidates:resolution.candidates?.length||0,openAlexId:saved?.openAlexId});}

function explicitIsbns(text: string): string[] {
  const candidates = text.match(/(?:ISBN(?:-1[03])?[:\s]*)?(?:97[89][\s-]?)?\d[\dXx\s-]{8,20}/g) || [];
  return [...new Set(candidates.map(normalizeIsbn).filter((value): value is string => Boolean(value && isValidIsbn(value))))];
}

async function googleBooks(query: string): Promise<any[]> {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', query); url.searchParams.set('maxResults', '5'); url.searchParams.set('printType', 'books');
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) url.searchParams.set('key', apiKey);
  let response = await fetch(url);
  if (response.status === 403 && url.searchParams.has('key')) {
    url.searchParams.delete('key');
    response = await fetch(url);
  }
  if (!response.ok) throw new Error(`Google Books ${response.status}`);
  return (await response.json()).items || [];
}

async function googleBooksQueries(queries: string[]): Promise<any[]> {
  const seen = new Set<string>();
  const results: any[] = [];
  for (const query of queries.map((value) => value.trim()).filter(Boolean)) {
    try {
      const items = await googleBooks(query);
      for (const item of items) {
        const key = item.id || `${item.volumeInfo?.title || ''}:${(item.volumeInfo?.authors || []).join('|')}`;
        if (!seen.has(key)) { seen.add(key); results.push(item); }
      }
    } catch {}
    if (results.length >= 8) break;
  }
  return results;
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
  const response = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/chat`, { method:'POST', headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(180_000), body:JSON.stringify({
    model: process.env.OLLAMA_MODEL || 'qwen3:1.7b', stream:false, think:false, format, options:{temperature:0,num_predict:128,num_ctx:4096},
    messages:[{role:'system',content:'Extract bibliographic search terms only from the supplied document evidence. Never invent an ISBN.'},{role:'user',content:text.slice(0,3000)+'\n\n[END]\n'+text.slice(-1000)}]
  }) });
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  return JSON.parse((await response.json()).message.content);
}

const evidenceText = (value: string): string => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const authorSurnames = (authors: string[] = []) => authors
  .map((author) => evidenceText(author).split(' ').filter(Boolean).at(-1))
  .filter((value): value is string => Boolean(value));

const volumeMatchesInference = (volume: any, inference: any): boolean => {
  const inferredTitle = evidenceText(String(inference?.title || ''));
  const providerTitle = evidenceText(String(volume?.title || ''));
  if (inferredTitle.length < 5 || providerTitle.length < 5) return false;
  const titleMatches = providerTitle.includes(inferredTitle) || inferredTitle.includes(providerTitle);
  if (!titleMatches) return false;
  const inferredAuthors = authorSurnames(inference?.authors || []);
  const providerAuthors = authorSurnames(volume?.authors || []);
  return !inferredAuthors.length || !providerAuthors.length || inferredAuthors.some((surname) => providerAuthors.includes(surname));
};

async function persistInference(job: Claimed, reference: any, inference: any, text: string): Promise<boolean> {
  const manual = new Set<string>(reference.source?.curation?.manualFields || []);
  const evidence = evidenceText(text.slice(0, 16_000));
  const candidateTitle = String(inference?.title || '').trim();
  const titleEvidence = evidenceText(candidateTitle);
  const titleAccepted = !manual.has('title') && titleEvidence.length >= 8 && evidence.includes(titleEvidence);
  const candidateAuthors = Array.isArray(inference?.authors) ? inference.authors.map((value:any)=>String(value).trim()).filter(Boolean) : [];
  const acceptedAuthors = candidateAuthors.filter((author:string) => {
    const parts = evidenceText(author).split(' ').filter(Boolean);
    return parts.length > 0 && evidence.includes(parts[parts.length - 1]);
  }).slice(0, 20);
  const numericYear = Number(inference?.year);
  const yearAccepted = !manual.has('issued') && Number.isInteger(numericYear)
    && numericYear >= 1000 && numericYear <= new Date().getFullYear() + 1 && evidence.includes(String(numericYear));
  const authorsAccepted = !manual.has('contributors') && acceptedAuthors.length > 0;
  if (!titleAccepted && !authorsAccepted && !yearAccepted) return false;
  const confidence = Math.max(0, Math.min(1, Number(inference?.confidence) || 0));
  await catalog.pool.query(`UPDATE catalog_references SET title=$2, contributors=$3::jsonb, issued=$4::jsonb,
    source=source || $5::jsonb, updated_at=now() WHERE id=$1`, [job.reference_id,
    titleAccepted ? candidateTitle : reference.title,
    JSON.stringify(authorsAccepted ? acceptedAuthors.map((name:string) => normalizeContributor(name, { inferSimpleNames: true })).filter(Boolean) : reference.contributors),
    JSON.stringify(yearAccepted ? {year:numericYear} : reference.issued),
    JSON.stringify({identification:{provider:'docling-ollama',status:'inferred',confidence,
      accepted:{title:titleAccepted,authors:authorsAccepted,year:yearAccepted},inference}})]);
  await renameWasabiOriginal(reference, {
    title: titleAccepted ? candidateTitle : reference.title,
    contributors: authorsAccepted ? acceptedAuthors.map((name:string) => normalizeContributor(name, { inferSimpleNames: true })).filter(Boolean) : reference.contributors,
    issued: yearAccepted ? { year: numericYear } : reference.issued,
  });
  await complete(job, 'summarize', { status:'inferred', provider:'docling-ollama', confidence,
    accepted:{title:titleAccepted,authors:authorsAccepted,year:yearAccepted} });
  return true;
}

async function identify(job: Claimed) {
  const paper=await catalog.getPaper((await referenceData(job.reference_id)).reference.owner_key,job.reference_id); if(paper){await complete(job,'summarize',{status:'skipped',reason:'scholarly-pipeline'});return;}
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
    const authors = (inference.authors || []).slice(0, 2);
    const queries = [
      [`intitle:${inference.title}`, ...authors.map((author:string)=>`inauthor:${author}`)].join(' '),
      [inference.title, ...authors].join(' '),
      [inference.title, ...authors, 'year'].join(' '),
      [inference.title, ...authors, 'publisher'].join(' '),
    ];
    items = await googleBooksQueries(queries);
    try { if (!items.length) items = await googleBooks(queries[0]); }
    catch { items = await openLibrary({ title: inference.title, authors: inference.authors }); }
    if (!items.length) items = await openLibrary({ title: inference.title, authors: inference.authors });
  }
  const normalizedEvidence = evidenceText(text.slice(0, 16_000));
  const matchedItem = items.find((item:any) => {
    const volume = item?.volumeInfo;
    const providerIsbns = (volume?.industryIdentifiers || []).map((identifier:any) => normalizeIsbn(identifier.identifier)).filter(Boolean);
    if (explicit.some((isbn) => providerIsbns.includes(isbn))) return true;
    const providerTitle = evidenceText(String(volume?.title || ''));
    if (providerTitle.length < 8 || !normalizedEvidence.includes(providerTitle)) return false;
    const authors = (volume?.authors || []).map((author:string) => evidenceText(author).split(' ').filter(Boolean).at(-1)).filter(Boolean);
    return !authors.length || authors.some((surname:string) => normalizedEvidence.includes(surname));
  }) || (inference ? items.find((item:any) => volumeMatchesInference(item?.volumeInfo, inference)) : undefined);
  const volume = matchedItem?.volumeInfo;
  if (!volume) {
    if (inference && await persistInference(job, reference, inference, text)) return;
    await complete(job, 'summarize', { status:'unresolved', explicit, inference });
    return;
  }
  const isbns = (volume.industryIdentifiers || []).map((item:any)=>normalizeIsbn(item.identifier)).filter((value:any)=>value && isValidIsbn(value));
  const manual = new Set<string>(reference.source?.curation?.manualFields || []);
  const title = manual.has('title') ? reference.title : (volume.title || reference.title);
  const contributors = manual.has('contributors') ? reference.contributors
    : (volume.authors || []).map((name:string) => normalizeContributor(name, { inferSimpleNames: true })).filter(Boolean);
  const issued = manual.has('issued') ? reference.issued
    : (volume.publishedDate ? {year:Number(String(volume.publishedDate).slice(0,4))||undefined} : null);
  const identifiers = manual.has('identifiers') ? reference.identifiers : { ...reference.identifiers, isbn: isbns };
  const publisher = manual.has('publisher') ? reference.publisher : (volume.publisher || reference.publisher || null);
  const url = manual.has('url') ? reference.url : (volume.canonicalVolumeLink || volume.infoLink || reference.url || null);
  await catalog.pool.query(`UPDATE catalog_references SET title=$2, contributors=$3::jsonb, issued=$4::jsonb,
    identifiers=$5::jsonb, language=COALESCE($6,language), publisher=$8, url=$9,
    source=source || $7::jsonb, updated_at=now() WHERE id=$1`,
    [job.reference_id, title, JSON.stringify(contributors), JSON.stringify(issued),
      JSON.stringify(identifiers), volume.language || null, JSON.stringify({identification:{provider:matchedItem.provider || 'google-books',volumeId:matchedItem.id,inference}}),
      publisher, url]);
  await renameWasabiOriginal(reference, { title, contributors, issued });
  await complete(job, 'summarize', { provider:matchedItem.provider || 'google-books', volumeId:matchedItem.id, explicit });
}

async function ollamaSummary(reference: any, text: string): Promise<{ summary: string; tags: string[] }> {
  const format = { type:'object', properties:{ summary:{type:'string'}, tags:{type:'array',items:{type:'string'} } }, required:['summary','tags'] };
  const response = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/chat`, { method:'POST', headers:{'content-type':'application/json'}, signal:AbortSignal.timeout(240_000), body:JSON.stringify({
    model: process.env.OLLAMA_MODEL || 'qwen3:1.7b', stream:false, think:false, format, options:{temperature:0.2,num_predict:700,num_ctx:8192},
    messages:[{role:'system',content:'Write a concise scholarly summary of the supplied text. Return JSON only.'},
      {role:'user',content:`Title: ${reference.title}\n\nText evidence:\n${text.slice(0,7000)}\n\n[END SAMPLE]\n${text.slice(-1500)}`}]
  }) });
  if (!response.ok) throw new Error(`Ollama ${response.status}`);
  const parsed = JSON.parse((await response.json()).message.content);
  return { summary: String(parsed.summary || '').trim(), tags: Array.isArray(parsed.tags) ? parsed.tags.map((tag:any)=>String(tag).trim()).filter(Boolean).slice(0, 20) : [] };
}

async function summarize(job: Claimed) {
  const { reference, artifacts } = await referenceData(job.reference_id);
  const markdown = artifacts.find((item) => item.kind === 'markdown');
  if (!markdown) throw new Error('Markdown derivative missing');
  const text = new TextDecoder().decode(await objectBytes(markdown.object_key));
  const result = await ollamaSummary(reference, text);
  if (!result.summary) throw new Error('Summary model returned empty output');
  const body = `# Summary\n\n${result.summary}\n\n${result.tags.length ? `## Tags\n\n${result.tags.map((tag) => `- ${tag}`).join('\n')}\n` : ''}`;
  const bytes = new TextEncoder().encode(body);
  const storageRoot = String(reference.source?.wasabiStorageRoot || `${process.env.WASABI_KEY_PREFIX || 'zzttuntref'}/seshat-derived/${reference.owner_key}`).replace(/\/+$/g, '');
  const key = `${storageRoot}/.seshat/${job.reference_id}/derived/ai/summary.md`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = await storage.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: 'text/markdown; charset=utf-8', CacheControl: 'private, no-store' }));
  await catalog.pool.query(`INSERT INTO catalog_artifacts
    (id,reference_id,kind,provider,object_key,bucket,mime_type,size_bytes,sha256,etag)
    VALUES($1,$2,'summary','ollama',$3,$4,'text/markdown; charset=utf-8',$5,$6,$7)
    ON CONFLICT(object_key) DO UPDATE SET size_bytes=excluded.size_bytes, sha256=excluded.sha256, etag=excluded.etag`,
    [randomUUID(), job.reference_id, key, bucket, bytes.byteLength, sha256, stored.ETag?.replaceAll('"','')]);
  const mergedTags = [...new Set([...(reference.tags || []), ...result.tags])].slice(0, 100);
  await catalog.pool.query('UPDATE catalog_references SET tags=$2::text[], updated_at=now() WHERE id=$1', [job.reference_id, mergedTags]);
  await complete(job, 'relate', { provider:'ollama', model:process.env.OLLAMA_MODEL || 'qwen3:1.7b', tags:result.tags });
}

const graphSlug = (value: unknown): string => String(value || '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'unknown';
const graphKey = (kind: string, label: string): string => `${kind}:${graphSlug(label)}`;
const edgeKey = (ownerKey: string, referenceId: string, from: string, relation: string, to: string, chunkId = ''): string =>
  createHash('sha256').update([ownerKey, referenceId, from, relation, to, chunkId].join('\0')).digest('hex');

async function extractGraphCandidates(reference: any, chunks: any[]): Promise<{
  entities: Array<{ label: string; kind: string; chunkOrdinal?: number }>;
  relations: Array<{ from: string; to: string; relation: string; chunkOrdinal?: number }>;
}> {
  const format = {
    type: 'object',
    properties: {
      entities: { type: 'array', items: { type: 'object', properties: {
        label: { type: 'string' }, kind: { type: 'string' }, chunkOrdinal: { type: ['integer','null'] },
      }, required: ['label','kind','chunkOrdinal'] } },
      relations: { type: 'array', items: { type: 'object', properties: {
        from: { type: 'string' }, to: { type: 'string' }, relation: { type: 'string' }, chunkOrdinal: { type: ['integer','null'] },
      }, required: ['from','to','relation','chunkOrdinal'] } },
    }, required: ['entities','relations'],
  };
  const evidence = chunks.slice(0, 12).map((chunk) => `[chunk ${chunk.ordinal}${chunk.locator ? ` · ${chunk.locator}` : ''}]\n${chunk.content.slice(0, 900)}`).join('\n\n');
  const response = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(360_000),
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'qwen3:1.7b', stream: false, think: false, format,
      options: { temperature: 0, num_predict: 1200, num_ctx: 16384 },
      messages: [
        { role: 'system', content: 'Extract a compact scholarly knowledge graph. Use only explicit evidence. Entity kinds: person, concept, work, organization, place, method, instrument. Relations must be short uppercase predicates. Preserve the supplied chunk ordinal as evidence.' },
        { role: 'user', content: `Document: ${reference.title}\n\n${evidence}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`OLLAMA_GRAPH_${response.status}`);
  let parsed: any = { entities: [], relations: [] };
  try {
    const rawContent = (await response.json()).message.content;
    parsed = JSON.parse(rawContent);
  } catch (error) {
    console.warn('[worker:graph-json-parse-failed]', error);
  }
  return {
    entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 120) : [],
    relations: Array.isArray(parsed.relations) ? parsed.relations.slice(0, 180) : [],
  };
}

async function relate(job: Claimed) {
  const { reference } = await referenceData(job.reference_id);
  const paper=await catalog.getPaper(reference.owner_key,job.reference_id);if(paper){await rebuildScholarlyGraph(catalog,reference.owner_key);await complete(job,'',{pipeline:'scholarly-v1'});return;}
  const chunkResult = await catalog.pool.query(
    'SELECT id,ordinal,content,page,locator,section,metadata FROM catalog_chunks WHERE reference_id=$1 ORDER BY ordinal',
    [job.reference_id],
  );
  const chunks = chunkResult.rows;
  const extracted = await extractGraphCandidates(reference, chunks);
  const documentKey = `document:${job.reference_id}`;
  const nodes = new Map<string, { key: string; kind: string; label: string; properties: Record<string, unknown> }>();
  const edges: Array<{ key: string; from: string; relation: string; to: string; chunkId?: string; weight: number; properties?: Record<string, unknown> }> = [];
  const addNode = (kind: string, label: string, properties: Record<string, unknown> = {}) => {
    const key = kind === 'document' ? documentKey : graphKey(kind, label);
    if (label.trim()) nodes.set(key, { key, kind, label: label.trim(), properties });
    return key;
  };
  const addEdge = (from: string, relation: string, to: string, chunkId?: string, weight = 1) => {
    const normalizedRelation = graphSlug(relation).replaceAll('-', '_').toUpperCase();
    edges.push({ key: edgeKey(reference.owner_key, job.reference_id, from, normalizedRelation, to, chunkId), from, relation: normalizedRelation, to, chunkId, weight });
  };

  addNode('document', reference.title, { citeKey: reference.cite_key, referenceId: job.reference_id });
  for (const person of reference.contributors || []) {
    const label = person.literal || [person.given, person.family].filter(Boolean).join(' ');
    if (label) addEdge(addNode('person', label), 'AUTHORED', documentKey, undefined, 1.4);
  }
  for (const tag of reference.tags || []) addEdge(documentKey, 'TAGGED', addNode('concept', tag), undefined, 1.1);
  for (const chunk of chunks) {
    const chunkKey = `chunk:${chunk.id}`;
    addNode('chunk', chunk.locator || `chunk ${chunk.ordinal + 1}`, { chunkId: chunk.id, ordinal: chunk.ordinal, page: chunk.page });
    addEdge(documentKey, 'CONTAINS', chunkKey, chunk.id, .5);
  }
  for (const entity of extracted.entities) {
    const kind = graphSlug(entity.kind || 'concept');
    const entityKey = addNode(kind, String(entity.label || ''));
    const evidence = chunks.find((chunk) => chunk.ordinal === Number(entity.chunkOrdinal));
    if (entityKey && evidence) addEdge(documentKey, 'DISCUSSES', entityKey, evidence.id, 1.2);
  }
  const entityKeys = new Map(extracted.entities.map((entity) => [String(entity.label || '').trim().toLowerCase(), graphKey(graphSlug(entity.kind || 'concept'), String(entity.label || ''))]));
  for (const relation of extracted.relations) {
    const from = entityKeys.get(String(relation.from || '').trim().toLowerCase());
    const to = entityKeys.get(String(relation.to || '').trim().toLowerCase());
    const evidence = chunks.find((chunk) => chunk.ordinal === Number(relation.chunkOrdinal));
    if (from && to) addEdge(from, relation.relation || 'RELATED_TO', to, evidence?.id, 1.5);
  }
  const graphNodes = [...nodes.values()];
  await catalog.replaceGraphForReference(reference.owner_key, job.reference_id, graphNodes, edges);
  await graphMirror.sync(reference.owner_key, graphNodes, edges).catch((error) => console.error('[worker:neo4j-mirror]', error));
  await complete(job, '', { nodes: graphNodes.length, edges: edges.length, neo4jMirrored: graphMirror.enabled });
}

async function indexVectorBatch(): Promise<boolean> {
  if (!vectorIndex.enabled) return false;
  const deletions = await catalog.pendingVectorDeletions();
  if (deletions.length) {
    try {
      await vectorIndex.delete(deletions);
      await catalog.completeVectorDeletions(deletions);
    } catch (error) {
      console.error('[worker:vector-delete]', error);
      return false;
    }
  }
  const chunks = await catalog.claimVectorChunks(Number(process.env.VECTOR_BATCH_SIZE || 8));
  if (!chunks.length) return false;
  try {
    const embeddings = await embedder.embed(chunks.map((chunk) => chunk.content));
    await vectorIndex.upsert(chunks.map((chunk, index) => ({
      id: chunk.id,
      vector: embeddings[index],
      sparse: computeSparseVector(chunk.content),
      payload: {
        ownerKey: chunk.ownerKey, referenceId: chunk.referenceId, ordinal: chunk.ordinal,
        title: chunk.title, citeKey: chunk.citeKey, page: chunk.page, locator: chunk.locator,
        section: chunk.section, tags: chunk.tags, language: chunk.language,
      },
    })));
    await catalog.markVectorChunks(chunks.map((chunk) => chunk.id), 'complete', embedder.model);
  } catch (error) {
    await catalog.markVectorChunks(chunks.map((chunk) => chunk.id), 'failed', embedder.model, String((error as any)?.message || error));
    console.error('[worker:vector]', error);
  }
  return true;
}

async function tick() {
  const job = await claim();
  if (!job) { await indexVectorBatch(); return; }
  try {
    if (job.stage === 'extract') await extract(job);
    else if (job.stage === 'scholarly') await scholarly(job);
    else if (job.stage === 'identify') await identify(job);
    else if (job.stage === 'summarize') await summarize(job);
    else await relate(job);
  }
  catch (error) { console.error(`[worker:${job.stage}]`, error); await fail(job, error); }
}

async function run() {
  try { await tick(); }
  catch (error) { console.error('[worker:loop]', error); }
  setTimeout(() => void run(), pollMs);
}

await catalog.ensureSchema();
await catalog.pool.query(`UPDATE catalog_jobs SET status='queued', error='worker restart recovery', updated_at=now() WHERE status='running'`);
await catalog.pool.query(`UPDATE catalog_chunks SET vector_status='pending',vector_error='worker restart recovery',updated_at=now() WHERE vector_status='running'`);
console.log(`[seshat-worker] online concurrency=1 model=${process.env.OLLAMA_MODEL || 'qwen3:1.7b'} vector=${vectorIndex.enabled ? vectorIndex.collection : 'deferred'} graph=${graphMirror.enabled ? 'postgres+neo4j' : 'postgres'}`);
void run();
