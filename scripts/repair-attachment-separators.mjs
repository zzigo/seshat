import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { zoteroStyleAttachmentName } from '@seshat/core';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const copySegment = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const required = (value, name) => { if (!value) throw new Error(`${name}_NOT_CONFIGURED`); return value; };
const pm2Environment = () => {
  try {
    const processes = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' }));
    const process = processes.find((entry) => entry.name === (globalThis.process.env.SESHAT_PM2_NAME || 'seshat-web'));
    return process?.pm2_env || {};
  } catch { return {}; }
};
const runtime = { ...pm2Environment(), ...process.env };
const bucket = runtime.WASABI_BUCKET || 'untref-licmusica';
const storage = new S3Client({
  region: runtime.WASABI_REGION || 'us-east-2',
  endpoint: required(runtime.WASABI_ENDPOINT, 'WASABI_ENDPOINT'),
  credentials: {
    accessKeyId: required(runtime.WASABI_ACCESS_KEY_ID, 'WASABI_ACCESS_KEY_ID'),
    secretAccessKey: required(runtime.WASABI_SECRET_ACCESS_KEY, 'WASABI_SECRET_ACCESS_KEY'),
  },
});
const pool = new pg.Pool({ connectionString: required(runtime.DATABASE_URL, 'DATABASE_URL') });
const result = await pool.query(
  `SELECT a.id AS artifact_id,a.reference_id,a.bucket,a.object_key,a.size_bytes,
          r.title,r.contributors,r.issued,r.source
   FROM catalog_artifacts a
   JOIN catalog_references r ON r.id=a.reference_id
   WHERE a.kind='original' AND a.bucket=$1
     AND (a.object_key LIKE '%*%' OR COALESCE(r.source->>'originalFilename','') LIKE '%*%')
   ORDER BY a.reference_id,a.created_at`,
  [bucket],
);

const plans = result.rows.map((row) => {
  const currentFilename = String(row.source?.originalFilename || row.object_key.split('/').at(-1) || 'document');
  const filename = zoteroStyleAttachmentName({
    contributors: row.contributors || [], issued: row.issued || undefined,
    title: row.title || 'Untitled reference', currentFilename,
  });
  const directory = row.object_key.includes('/') ? row.object_key.slice(0, row.object_key.lastIndexOf('/') + 1) : '';
  return { ...row, currentFilename, filename, nextKey: `${directory}${filename}` };
}).filter((row) => row.nextKey !== row.object_key);

let backup = null;
if (apply && plans.length) {
  const directory = join(process.cwd(), 'var', 'migrations');
  await mkdir(directory, { recursive: true });
  backup = join(directory, `attachment-separators-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(backup, JSON.stringify(plans.map((row) => ({
    artifactId: row.artifact_id, referenceId: row.reference_id, bucket: row.bucket,
    objectKey: row.object_key, originalFilename: row.currentFilename, nextKey: row.nextKey,
  })), null, 2), { mode: 0o600 });
}

let renamed = 0;
let oldObjectsDeleted = 0;
const failures = [];
for (const plan of plans) {
  if (!apply) continue;
  let copied = false;
  let catalogLinked = false;
  try {
    try {
      await storage.send(new HeadObjectCommand({ Bucket: plan.bucket, Key: plan.nextKey }));
      throw new Error('TARGET_ALREADY_EXISTS');
    } catch (error) {
      if (String(error?.message || '') === 'TARGET_ALREADY_EXISTS') throw error;
      if (Number(error?.$metadata?.httpStatusCode) !== 404 && !['NotFound', 'NoSuchKey'].includes(String(error?.name || ''))) throw error;
    }
    const copiedObject = await storage.send(new CopyObjectCommand({
      Bucket: plan.bucket, Key: plan.nextKey,
      CopySource: `${copySegment(plan.bucket)}/${plan.object_key.split('/').map(copySegment).join('/')}`,
      MetadataDirective: 'COPY',
    }));
    copied = true;
    const verified = await storage.send(new HeadObjectCommand({ Bucket: plan.bucket, Key: plan.nextKey }));
    if (Number(verified.ContentLength || 0) !== Number(plan.size_bytes || 0)) throw new Error('COPIED_SIZE_MISMATCH');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const artifact = await client.query(
        `UPDATE catalog_artifacts SET object_key=$3,etag=COALESCE($4,etag)
         WHERE id=$1 AND object_key=$2`,
        [plan.artifact_id, plan.object_key, plan.nextKey, copiedObject.CopyObjectResult?.ETag?.replaceAll('"', '') || null],
      );
      if (artifact.rowCount !== 1) throw new Error('ARTIFACT_LINK_UPDATE_FAILED');
      await client.query(
        `UPDATE catalog_references SET source=jsonb_set(
           jsonb_set(source,'{originalFilename}',to_jsonb($2::text),true),
           '{wasabiObjectKey}',to_jsonb($3::text),true
         ),updated_at=now() WHERE id=$1`,
        [plan.reference_id, plan.filename, plan.nextKey],
      );
      await client.query('COMMIT');
      catalogLinked = true;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    renamed += 1;
    try {
      await storage.send(new DeleteObjectCommand({ Bucket: plan.bucket, Key: plan.object_key }));
      oldObjectsDeleted += 1;
    } catch (error) {
      failures.push({ referenceId: plan.reference_id, stage: 'old-object-delete', error: String(error?.message || error) });
    }
  } catch (error) {
    if (copied && !catalogLinked) await storage.send(new DeleteObjectCommand({ Bucket: plan.bucket, Key: plan.nextKey })).catch(() => undefined);
    failures.push({ referenceId: plan.reference_id, stage: 'rename', error: String(error?.message || error) });
  }
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run', candidates: result.rowCount || 0, planned: plans.length,
  renamed, oldObjectsDeleted, failures, backup,
  sample: plans.slice(0, 12).map((row) => ({ from: row.currentFilename, to: row.filename })),
}, null, 2));
await pool.end();
