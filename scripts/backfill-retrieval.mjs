import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgresCatalog } from '@seshat/catalog';
import { normalizeDoclingChunk } from '@seshat/retrieval';

const apply = process.argv.includes('--apply');
const queueRelate = process.argv.includes('--queue-relate');
const catalog = new PostgresCatalog(process.env.DATABASE_URL || '');
await catalog.ensureSchema();

const storage = new S3Client({
  region: process.env.WASABI_REGION || 'us-east-2',
  endpoint: process.env.WASABI_ENDPOINT || 'https://s3.us-east-2.wasabisys.com',
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY || '',
  },
});

const result = await catalog.pool.query(
  `SELECT DISTINCT ON (reference.id)
     reference.id,reference.owner_key,artifact.bucket,artifact.object_key
   FROM catalog_references reference
   JOIN catalog_artifacts artifact ON artifact.reference_id=reference.id AND artifact.kind='chunks'
   ORDER BY reference.id,artifact.created_at DESC`,
);

let documents = 0;
let chunks = 0;
const failures = [];

for (const row of result.rows) {
  try {
    const object = await storage.send(new GetObjectCommand({
      Bucket: row.bucket || process.env.WASABI_BUCKET || 'untref-licmusica',
      Key: row.object_key,
    }));
    if (!object.Body) throw new Error('empty_object');
    const sourceRows = (await object.Body.transformToString())
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const normalized = sourceRows
      .map((item, ordinal) => normalizeDoclingChunk(row.id, ordinal, item))
      .filter(Boolean);
    if (apply) await catalog.replaceChunks(row.id, row.owner_key, normalized);
    documents += 1;
    chunks += normalized.length;
  } catch (error) {
    failures.push({ referenceId: row.id, error: String(error?.message || error).slice(0, 200) });
  }
}

let relateQueued = 0;
if (apply && queueRelate) {
  const queued = await catalog.pool.query(
    `UPDATE catalog_jobs
     SET status='queued',attempts=0,error=NULL,updated_at=now()
     WHERE stage='relate' AND reference_id IN (SELECT DISTINCT reference_id FROM catalog_chunks)
     RETURNING id`,
  );
  relateQueued = queued.rowCount || 0;
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  candidates: result.rowCount || 0,
  documents,
  chunks,
  relateQueued,
  failures,
}));
await catalog.pool.end();
