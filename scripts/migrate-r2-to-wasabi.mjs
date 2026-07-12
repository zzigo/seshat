import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const legacyBucket = process.env.LEGACY_R2_BUCKET || 'musiki-images';
const wasabiBucket = process.env.WASABI_BUCKET || 'untref-licmusica';
const prefix = String(process.env.WASABI_KEY_PREFIX || 'zzttuntref').replace(/^\/+|\/+$/g, '');
const rootUsers = new Set(String(process.env.SESHAT_LIBRARY_ROOT_USERS || '')
  .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean));

const pm2Environment = (id) => Object.fromEntries(execFileSync('pm2', ['env', id], { encoding: 'utf8' })
  .split(/\r?\n/)
  .map((line) => {
    const separator = line.indexOf(':');
    return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : null;
  })
  .filter(Boolean));

const legacyEnv = pm2Environment(process.env.MUSIKI_PM2_ID || '7');
const required = (value, name) => {
  if (!value) throw new Error(`${name}_NOT_CONFIGURED`);
  return value;
};
const r2 = new S3Client({
  region: 'auto', endpoint: required(legacyEnv.R2_ENDPOINT, 'LEGACY_R2_ENDPOINT'),
  credentials: {
    accessKeyId: required(legacyEnv.R2_ACCESS_KEY_ID, 'LEGACY_R2_ACCESS_KEY_ID'),
    secretAccessKey: required(legacyEnv.R2_SECRET_ACCESS_KEY, 'LEGACY_R2_SECRET_ACCESS_KEY'),
  },
});
const wasabi = new S3Client({
  region: process.env.WASABI_REGION || 'us-east-2',
  endpoint: required(process.env.WASABI_ENDPOINT, 'WASABI_ENDPOINT'),
  credentials: {
    accessKeyId: required(process.env.WASABI_ACCESS_KEY_ID, 'WASABI_ACCESS_KEY_ID'),
    secretAccessKey: required(process.env.WASABI_SECRET_ACCESS_KEY, 'WASABI_SECRET_ACCESS_KEY'),
  },
});
const pool = new pg.Pool({ connectionString: required(process.env.DATABASE_URL, 'DATABASE_URL') });
const result = await pool.query(
  `SELECT a.*,r.owner_key,r.source,
     ARRAY(SELECT lower(i.current_email) FROM catalog_identities i WHERE i.owner_key=r.owner_key) AS owner_emails
   FROM catalog_artifacts a JOIN catalog_references r ON r.id=a.reference_id
   WHERE a.bucket=$1 ORDER BY a.reference_id,a.created_at`,
  [legacyBucket],
);

let migrated = 0;
let deletedFromR2 = 0;
let bytes = 0;
const failures = [];
for (const artifact of result.rows) {
  const special = (artifact.owner_emails || []).some((email) => rootUsers.has(email) || rootUsers.has(email.split('@')[0]));
  const storageRoot = special ? `${prefix}/libros` : `${prefix}/lseshat/legacy-${artifact.owner_key.slice(0, 8)}`;
  const objectKey = `${storageRoot}/.seshat/${artifact.reference_id}/legacy/${artifact.kind}/${basename(artifact.object_key)}`;
  if (!apply) continue;
  try {
    const source = await r2.send(new GetObjectCommand({ Bucket: artifact.bucket, Key: artifact.object_key }));
    if (!source.Body) throw new Error('LEGACY_OBJECT_EMPTY');
    const body = await source.Body.transformToByteArray();
    const stored = await wasabi.send(new PutObjectCommand({
      Bucket: wasabiBucket, Key: objectKey, Body: body,
      ContentType: source.ContentType || artifact.mime_type || 'application/octet-stream',
      CacheControl: 'private, no-store',
      Metadata: { 'migrated-from': 'cloudflare-r2', 'artifact-id': artifact.id },
    }));
    const verified = await wasabi.send(new HeadObjectCommand({ Bucket: wasabiBucket, Key: objectKey }));
    if (Number(verified.ContentLength || 0) !== Number(artifact.size_bytes)) throw new Error('MIGRATED_SIZE_MISMATCH');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE catalog_artifacts SET bucket=$2,object_key=$3,
           provider=CASE WHEN provider='r2' THEN 'wasabi' ELSE provider END,etag=$4
         WHERE id=$1 AND bucket=$5`,
        [artifact.id, wasabiBucket, objectKey, stored.ETag?.replaceAll('"', '') || null, legacyBucket],
      );
      if (artifact.kind === 'original') {
        await client.query(
          `UPDATE catalog_references SET source=jsonb_set(
             jsonb_set(source,'{wasabiStorageRoot}',to_jsonb($2::text),true),
             '{wasabiObjectKey}',to_jsonb($3::text),true
           ),updated_at=now() WHERE id=$1`,
          [artifact.reference_id, storageRoot, objectKey],
        );
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    migrated += 1;
    bytes += body.byteLength;
    try {
      await r2.send(new DeleteObjectCommand({ Bucket: artifact.bucket, Key: artifact.object_key }));
      deletedFromR2 += 1;
    } catch (error) {
      failures.push({ artifactId: artifact.id, stage: 'legacy-delete', error: String(error?.message || error) });
    }
  } catch (error) {
    failures.push({ artifactId: artifact.id, stage: 'migration', error: String(error?.message || error) });
  }
}
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', candidates: result.rowCount || 0, migrated, deletedFromR2, bytes, failures }, null, 2));
await pool.end();
