import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PostgresCatalog } from '@seshat/catalog';

const apply = process.argv.includes('--apply');
const catalog = new PostgresCatalog(process.env.DATABASE_URL || ''); await catalog.ensureSchema();
const storage = new S3Client({ region: process.env.WASABI_REGION || 'us-east-2', endpoint: process.env.WASABI_ENDPOINT || 'https://s3.us-east-2.wasabisys.com',
  credentials: { accessKeyId: process.env.WASABI_ACCESS_KEY_ID || '', secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY || '' } });
const rows = await catalog.pool.query(
  `SELECT r.id,a.bucket,a.object_key FROM catalog_references r JOIN catalog_artifacts a ON a.reference_id=r.id AND a.kind='markdown'
   WHERE r.word_count=0 ORDER BY r.id`,
);
let updated = 0; let words = 0;
if (apply) for (const row of rows.rows) {
  const object = await storage.send(new GetObjectCommand({ Bucket: row.bucket || process.env.WASABI_BUCKET || 'untref-licmusica', Key: row.object_key }));
  const text = await object.Body.transformToString(); const count = (text.match(/\p{L}[\p{L}\p{N}'’\-]*/gu) || []).length;
  await catalog.pool.query('UPDATE catalog_references SET word_count=$2 WHERE id=$1', [row.id, count]); updated += 1; words += count;
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates: rows.rowCount || 0, updated, words }));
await catalog.pool.end();
