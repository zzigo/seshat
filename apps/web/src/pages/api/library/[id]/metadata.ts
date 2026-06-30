import { isValidIsbn, normalizeIsbn } from '@seshat/core';
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

  const authors = text(form.get('authors')).split(/[\n;]+/)
    .map((author) => author.trim()).filter(Boolean);
  if (authors.length > 50 || authors.some((author) => author.length > 300)) {
    return Response.json({ error: 'Use at most 50 authors, one per line.' }, { status: 400 });
  }

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
  const reference = await catalog.updateMetadata(ownerKey, current.id, {
    title,
    citeKey,
    type,
    contributors: authors.map((literal) => ({ literal, role: 'author' })),
    issued: year === null ? undefined : { year },
    identifiers: { ...current.identifiers, isbn: isbns },
    tags,
    abstract: abstract || undefined,
    language: language || undefined,
    manualFields: ['title', 'citeKey', 'type', 'contributors', 'issued', 'identifiers', 'tags', 'abstract', 'language'],
  });
  return Response.json({ ok: true, reference });
};
