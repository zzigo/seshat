import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { getWasabiBucket, getWasabiClient } from '../../../lib/wasabi';
import {
  getWasabiLibraryRoot,
  normalizeWasabiRoot,
  safeWasabiRelativePath,
  validWasabiRoot,
  wasabiUnicodePathForms,
} from '../../../lib/wasabi-settings';

const supportedDocument = /\.(pdf|epub|docx|txt|webarchive|djvu|djv)$/i;
const MAX_SCANNED_OBJECTS = 25_000;
const MAX_RETURNED_ORPHANS = 10_000;
const MAX_DELETE_OBJECTS = 500;

const context = async (locals: App.Locals) => {
  const user = (locals.session as any)?.user;
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return null;
  const ownerKey = ownerKeyFor(email);
  return {
    catalog: getCatalog(),
    email,
    identity: { email, name: String(user?.name || '') },
    ownerKey,
  };
};

const directory = (key: string) => key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : '';
const deletableKeyWithinRoot = (key:string,root:string) => {
  const normalized=normalizeWasabiRoot(key),normalizedRoot=normalizeWasabiRoot(root);
  return validWasabiRoot(normalized)&&normalized.startsWith(`${normalizedRoot}/`);
};

export const GET: APIRoute = async ({ locals, url }) => {
  const value = await context(locals);
  if (!value) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const root = await getWasabiLibraryRoot(value.ownerKey, value.identity);
  const requestedPaths = url.searchParams.getAll('path');
  const parsedPaths=requestedPaths.map(safeWasabiRelativePath);
  if (parsedPaths.some((path)=>path===null)) {
    return Response.json({ error: 'invalid_wasabi_path' }, { status: 400 });
  }
  const paths = requestedPaths.length ? [...new Set(parsedPaths as string[])] : [''];
  const query = url.searchParams.get('q')?.trim().toLocaleLowerCase() || '';
  const linked = await value.catalog.pool.query('SELECT object_key FROM catalog_artifacts');
  const linkedKeys = new Set(linked.rows.map((row: any) => String(row.object_key || '').normalize('NFC')));
  const storage = getWasabiClient();
  const bucket = getWasabiBucket();
  const seen = new Set<string>();
  const objects: Array<{
    key: string;
    path: string;
    filename: string;
    directory: string;
    sizeBytes: number;
    lastModified?: string;
  }> = [];
  let scanned = 0;
  let truncated = false;

  scan: for (const relativePath of paths) {
    const variants = wasabiUnicodePathForms(relativePath ? `${root}/${relativePath}` : root);
    for (const variant of variants) {
      let token: string | undefined;
      do {
        const result = await storage.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: `${variant.replace(/\/+$/, '')}/`,
          ContinuationToken: token,
          MaxKeys: 1000,
        }));
        for (const object of result.Contents || []) {
          scanned += 1;
          const key = String(object.Key || '');
          const identity = key.normalize('NFC');
          const filename = key.split('/').at(-1) || '';
          if (!key || seen.has(identity) || !supportedDocument.test(filename) || key.includes('/.seshat-derived/')) continue;
          seen.add(identity);
          if (linkedKeys.has(identity)) continue;
          const path = key.startsWith(`${root}/`) ? key.slice(root.length + 1) : key;
          if (query && !`${filename} ${path}`.toLocaleLowerCase().includes(query)) continue;
          if (objects.length < MAX_RETURNED_ORPHANS) {
            objects.push({
              key,
              path,
              filename,
              directory: directory(path),
              sizeBytes: Number(object.Size || 0),
              lastModified: object.LastModified?.toISOString(),
            });
          } else truncated = true;
          if (scanned >= MAX_SCANNED_OBJECTS) { truncated = true; break scan; }
        }
        token = result.NextContinuationToken;
      } while (token);
    }
  }

  objects.sort((left, right) => left.path.localeCompare(right.path));
  return Response.json({
    objects,
    count: objects.length,
    scanned,
    truncated,
    root,
    paths,
  });
};

export const DELETE: APIRoute = async ({ locals, request }) => {
  const value = await context(locals);
  if (!value) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null) as { keys?: unknown } | null;
  const requested = Array.isArray(body?.keys)
    ? [...new Set(body!.keys.map((key) => String(key || '')).filter(Boolean))].slice(0, MAX_DELETE_OBJECTS)
    : [];
  if (!requested.length) return Response.json({ error: 'select_orphan_files' }, { status: 400 });
  const root = await getWasabiLibraryRoot(value.ownerKey, value.identity);
  const valid = requested.filter((key) => deletableKeyWithinRoot(key, root) && supportedDocument.test(key));
  if (valid.length !== requested.length) return Response.json({ error: 'invalid_wasabi_object' }, { status: 400 });

  // Recheck immediately before deleting: an object that has become active
  // since the audit must never be removed.
  const active = await value.catalog.pool.query(
    'SELECT object_key FROM catalog_artifacts WHERE object_key=ANY($1::text[])',
    [valid],
  );
  const blocked = new Set(active.rows.map((row: any) => String(row.object_key || '')));
  const removable = valid.filter((key) => !blocked.has(key));
  if (removable.length) {
    await getWasabiClient().send(new DeleteObjectsCommand({
      Bucket: getWasabiBucket(),
      Delete: { Quiet: true, Objects: removable.map((Key) => ({ Key })) },
    }));
  }
  return Response.json({
    ok: true,
    deleted: removable,
    blocked: valid.filter((key) => blocked.has(key)),
  });
};
