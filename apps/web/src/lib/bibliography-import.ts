import { createHash, randomUUID } from 'node:crypto';
import { HeadObjectCommand, type HeadObjectCommandOutput } from '@aws-sdk/client-s3';
import type { CatalogBibliographyInput } from '@seshat/catalog';
import type { Contributor } from '@seshat/core';
import { mapBibAttachment, type BibliographyAttachmentPath, type SeshatUserIdentity } from './bibliography-paths';
import { getWasabiBucket, getWasabiClient } from './wasabi';

export type AttachmentStatus = 'linked' | 'missing' | 'none' | 'storage-unavailable';

export interface InspectedBibEntry {
  entry: any;
  attachment: (BibliographyAttachmentPath & {
    status: AttachmentStatus;
    sizeBytes?: number;
    etag?: string;
    mimeType?: string;
    sha256?: string;
  }) | null;
}

const mediaType = (filename: string): string => {
  if (/\.pdf$/i.test(filename)) return 'application/pdf';
  if (/\.docx$/i.test(filename)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (/\.epub$/i.test(filename)) return 'application/epub+zip';
  return 'text/plain; charset=utf-8';
};

const objectSha256 = (bucket: string, objectKey: string, head: HeadObjectCommandOutput): string => {
  const metadataHash = String(head.Metadata?.sha256 || '').toLowerCase();
  if (/^[a-f0-9]{64}$/.test(metadataHash)) return metadataHash;
  return createHash('sha256').update(['wasabi', bucket, objectKey, head.ETag || '', head.ContentLength || 0].join('\0')).digest('hex');
};

const isMissing = (error: any): boolean => ['NotFound', 'NoSuchKey'].includes(String(error?.name || ''))
  || Number(error?.$metadata?.httpStatusCode) === 404;

export const inspectBibEntries = async (entries: any[], identity: SeshatUserIdentity): Promise<InspectedBibEntry[]> => {
  let bucket = '';
  let storage: ReturnType<typeof getWasabiClient> | null = null;
  try { bucket = getWasabiBucket(); storage = getWasabiClient(); } catch { /* preview still shows the intended mapping */ }
  const inspected: InspectedBibEntry[] = [];
  for (let offset = 0; offset < entries.length; offset += 12) {
    const batch = entries.slice(offset, offset + 12);
    inspected.push(...await Promise.all(batch.map(async (entry): Promise<InspectedBibEntry> => {
      const mapped = mapBibAttachment(entry?.fields?.file, identity);
      if (!mapped) return { entry, attachment: null };
      if (!storage) return { entry, attachment: { ...mapped, status: 'storage-unavailable' } };
      try {
        const head = await storage.send(new HeadObjectCommand({ Bucket: bucket, Key: mapped.objectKey }));
        return { entry, attachment: {
          ...mapped, status: 'linked', sizeBytes: Number(head.ContentLength || 0),
          etag: head.ETag?.replaceAll('"', ''), mimeType: head.ContentType || mediaType(mapped.filename),
          sha256: objectSha256(bucket, mapped.objectKey, head),
        } };
      } catch (error) {
        if (!isMissing(error)) console.error('[seshat:bibtex:wasabi-head]', mapped.objectKey, error);
        return { entry, attachment: { ...mapped, status: isMissing(error) ? 'missing' : 'storage-unavailable' } };
      }
    })));
  }
  return inspected;
};

const bibType = (value: string): string => ({
  article: 'article-journal', book: 'book', inbook: 'chapter', incollection: 'chapter',
  inproceedings: 'paper-conference', conference: 'paper-conference', proceedings: 'book',
  phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report',
}[value.toLowerCase()] || 'document');

const literal = (value: unknown): string => Array.isArray(value) ? value.map(String).join('; ') : String(value || '').trim();
const keywordList = (value: unknown): string[] => [...new Set(literal(value).split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean))].slice(0, 200);

export const catalogInputForBibEntry = (
  inspected: InspectedBibEntry,
  sourceFile: string,
): CatalogBibliographyInput => {
  const entry = inspected.entry;
  const fields = (entry.fields || {}) as Record<string, any>;
  const people = (field: string, role: Contributor['role']): Contributor[] => (Array.isArray(fields[field]) ? fields[field] : []).map((person: any) => ({
    family: String(person.lastName || '').trim(), given: String(person.firstName || '').trim(), role,
  })).filter((person: Contributor) => person.family || person.given);
  const contributors = [...people('author', 'author'), ...people('editor', 'editor'), ...people('translator', 'translator')];
  const year = Number(String(fields.year || fields.date || '').match(/\d{4}/)?.[0]) || undefined;
  const isbn = literal(fields.isbn).split(/[;,\s]+/).filter(Boolean);
  const doi = literal(fields.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  const input = String(entry.input || JSON.stringify(entry));
  const attachment = inspected.attachment?.status === 'linked' ? inspected.attachment : null;
  const bucket = attachment ? getWasabiBucket() : undefined;
  return {
    id: randomUUID(), citeKey: String(entry.key || `import-${randomUUID().slice(0, 8)}`).slice(0, 160),
    type: bibType(String(entry.type || 'document')), title: literal(fields.title) || 'Untitled reference',
    contributors, issued: year ? { year } : undefined,
    identifiers: { ...(isbn.length ? { isbn } : {}), ...(doi ? { doi } : {}) },
    tags: [], abstract: literal(fields.abstract) || undefined, language: literal(fields.language) || undefined,
    publisher: literal(fields.publisher || fields.institution || fields.school || fields.organization) || undefined,
    publisherPlace: literal(fields.address || fields.location) || undefined,
    url: literal(fields.url) || undefined,
    source: {
      provider: 'bibtex', sourceFile, importedAt: new Date().toISOString(), bibtex: fields, raw: input,
      keywords: keywordList(fields.keywords),
      ...(attachment ? { originalFilename: attachment.filename, wasabiObjectKey: attachment.objectKey, wasabiStorageRoot: attachment.storageRoot } : {}),
    },
    originalSha256: createHash('sha256').update(`bibtex\0${input}`).digest('hex'),
    originalFilename: attachment?.filename,
    artifact: attachment && bucket ? {
      id: randomUUID(), kind: 'original', provider: 'wasabi-linked', objectKey: attachment.objectKey,
      bucket, mimeType: attachment.mimeType || mediaType(attachment.filename), sizeBytes: attachment.sizeBytes || 0,
      sha256: attachment.sha256 || createHash('sha256').update(`wasabi\0${bucket}\0${attachment.objectKey}`).digest('hex'),
      etag: attachment.etag,
    } : undefined,
  };
};
