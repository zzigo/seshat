import { isValidIsbn, normalizeContributors, normalizeIsbn } from '@seshat/core';
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { APIRoute } from 'astro';
import { zoteroStyleAttachmentName } from '../../../../lib/attachment-filename';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { getWasabiClient } from '../../../../lib/wasabi';

const text = (value: FormDataEntryValue | null): string => String(value || '').trim();
const copySegment = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);

export const POST: APIRoute = async ({ request, locals, params }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: 'invalid_form' }, { status: 400 });
  const title = text(form.get('title')).replace(/\s+/g, ' ');
  if (!title || title.length > 1000) {
    return Response.json({ error: 'Title must contain between 1 and 1000 characters.' }, { status: 400 });
  }

  let contributorInput: unknown[];
  const structured = form.get('contributors');
  if (structured !== null) {
    try { const parsed = JSON.parse(String(structured)); if (!Array.isArray(parsed)) throw new Error('array'); contributorInput = parsed; }
    catch { return Response.json({ error: 'Contributors must be a valid array.' }, { status: 400 }); }
  } else {
    contributorInput = text(form.get('authors')).split(/[\n;]+/).map((author) => author.trim()).filter(Boolean);
  }
  if (contributorInput.length > 50) return Response.json({ error: 'Use at most 50 contributors.' }, { status: 400 });
  const contributors = normalizeContributors(contributorInput);

  const yearText = text(form.get('year'));
  const year = yearText ? Number(yearText) : null;
  if (year !== null && (!Number.isInteger(year) || year < 1 || year > 2100)) {
    return Response.json({ error: 'Year must be between 1 and 2100.' }, { status: 400 });
  }

  const rawIsbns = text(form.get('isbns')).split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean);
  const isbns = [...new Set(rawIsbns.map(normalizeIsbn).filter((value): value is string => Boolean(value)))];
  if (isbns.some((isbn) => !isValidIsbn(isbn))) {
    return Response.json({ error: 'One or more ISBNs have an invalid checksum.' }, { status: 400 });
  }

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);
  const current = await catalog.get(ownerKey, params.id || '');
  if (!current) return Response.json({ error: 'not_found' }, { status: 404 });
  const citeKey = text(form.get('citeKey')) || current.citeKey;
  if (!/^[A-Za-z0-9:_-]{1,160}$/.test(citeKey)) {
    return Response.json({ error: 'Citekey may use letters, numbers, colon, underscore and hyphen.' }, { status: 400 });
  }
  const type = text(form.get('type')) || current.type;
  const allowedTypes = new Set(['article', 'article-journal', 'book', 'chapter', 'document', 'paper-conference', 'report', 'thesis']);
  if (!allowedTypes.has(type)) return Response.json({ error: 'Unsupported reference type.' }, { status: 400 });
  const tags = [...new Set(text(form.get('tags')).split(/[,;\n]+/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 100);
  const language = text(form.get('language')).slice(0, 32);
  const abstract = text(form.get('abstract')).slice(0, 20_000);
  const publisher = text(form.get('publisher')).slice(0, 500);
  const publisherPlace = text(form.get('publisherPlace')).slice(0, 500);
  const rawUrl = text(form.get('url')).slice(0, 2_000);
  let url: string | undefined;
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
      url = parsed.toString();
    } catch { return Response.json({ error: 'URL must be a valid http(s) address.' }, { status: 400 }); }
  }
  const currentYear = current.issued?.year ? String(current.issued.year) : '';
  const currentIsbns = ((current.identifiers?.isbn as string[] | undefined) || []).join('\n');
  const existingManual = new Set<string>((current.source?.curation as any)?.manualFields || []);
  const manualFields = new Set<string>(existingManual);
  const markChanged = (field: string, before: string, after: string) => {
    if (before.trim() !== after.trim()) manualFields.add(field);
  };
  markChanged('title', current.title || '', title);
  markChanged('citeKey', current.citeKey || '', citeKey);
  markChanged('type', current.type || '', type);
  markChanged('contributors', JSON.stringify(current.contributors || []), JSON.stringify(contributors));
  markChanged('issued', currentYear, year === null ? '' : String(year));
  markChanged('identifiers', currentIsbns, isbns.join('\n'));
  markChanged('tags', (current.tags || []).join('\n'), tags.join('\n'));
  markChanged('abstract', current.abstract || '', abstract);
  markChanged('language', current.language || '', language);
  markChanged('publisher', current.publisher || '', publisher);
  markChanged('publisherPlace', current.publisherPlace || '', publisherPlace);
  markChanged('url', current.url || '', url || '');
  const reference = await catalog.updateMetadata(ownerKey, current.id, {
    title,
    citeKey,
    type,
    contributors,
    issued: year === null ? undefined : { year },
    identifiers: { ...current.identifiers, isbn: isbns },
    tags,
    abstract: abstract || undefined,
    language: language || undefined,
    publisher: publisher || undefined,
    publisherPlace: publisherPlace || undefined,
    url,
    manualFields: [...manualFields],
  });
  let storageRename: { ok: boolean; from?: string; to?: string; warning?: string } = { ok: true };
  const original = reference?.artifacts.find((artifact) => artifact.kind === 'original' && artifact.bucket && artifact.objectKey);
  if (reference && original && ['wasabi', 'wasabi-linked'].includes(original.provider)) {
    const currentFilename = String((reference.source as any).originalFilename || original.objectKey.split('/').at(-1) || 'document');
    const filename = zoteroStyleAttachmentName({ contributors: reference.contributors, issued: reference.issued, title: reference.title, currentFilename });
    const directory = original.objectKey.includes('/') ? original.objectKey.slice(0, original.objectKey.lastIndexOf('/') + 1) : '';
    const nextKey = `${directory}${filename}`;
    if (nextKey !== original.objectKey) {
      const storage = getWasabiClient();
      const copySource = `${copySegment(original.bucket!)}/${original.objectKey.split('/').map(copySegment).join('/')}`;
      let copied = false;
      let catalogLinked = false;
      try {
        try {
          await storage.send(new HeadObjectCommand({ Bucket: original.bucket, Key: nextKey }));
          throw new Error('TARGET_ALREADY_EXISTS');
        } catch (error: any) {
          if (String(error?.message || '') === 'TARGET_ALREADY_EXISTS') throw error;
          if (Number(error?.$metadata?.httpStatusCode) !== 404 && !['NotFound', 'NoSuchKey'].includes(String(error?.name || ''))) throw error;
        }
        const moved = await storage.send(new CopyObjectCommand({ Bucket: original.bucket, Key: nextKey, CopySource: copySource, MetadataDirective: 'COPY' }));
        copied = true;
        const verified = await storage.send(new HeadObjectCommand({ Bucket: original.bucket, Key: nextKey }));
        if (Number(verified.ContentLength || 0) !== Number(original.sizeBytes)) throw new Error('COPIED_SIZE_MISMATCH');
        const renamed = await catalog.renameArtifact(ownerKey, reference.id, original.id, nextKey, filename, moved.CopyObjectResult?.ETag?.replaceAll('"', ''));
        if (!renamed) throw new Error('ARTIFACT_LINK_UPDATE_FAILED');
        catalogLinked = true;
        await storage.send(new DeleteObjectCommand({ Bucket: original.bucket, Key: original.objectKey }))
          .catch((error) => console.error('[seshat:metadata:wasabi-old-object-cleanup]', error));
        storageRename = { ok: true, from: original.objectKey, to: nextKey };
      } catch (error) {
        if (copied && !catalogLinked) await storage.send(new DeleteObjectCommand({ Bucket: original.bucket, Key: nextKey })).catch(() => undefined);
        console.error('[seshat:metadata:wasabi-rename]', error);
        storageRename = { ok: false, warning: 'Metadata was saved, but the Wasabi file kept its previous name.' };
      }
    }
  }
  const hydrated = reference ? await catalog.get(ownerKey, reference.id) : reference;
  return Response.json({ ok: true, reference: hydrated, storageRename });
};
