import { isValidIsbn, normalizeContributors, normalizeIsbn } from '@seshat/core';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';

const text = (value: FormDataEntryValue | null): string => String(value || '').trim();

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
  return Response.json({ ok: true, reference });
};
