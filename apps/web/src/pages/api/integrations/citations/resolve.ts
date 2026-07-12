import type { APIRoute } from 'astro';
import { normalizeBibliographicType } from '@seshat/core';
import { getCatalog, ownerKeyFor } from '../../../../lib/catalog';
import { authenticateIntegration } from '../../../../lib/integration-auth';

const cslType = (type: string): string => {
  const types: Record<string, string> = {
    article: 'article-journal', book: 'book', booklet: 'pamphlet', inbook: 'chapter', incollection: 'chapter',
    conference: 'paper-conference', inproceedings: 'paper-conference', proceedings: 'book', manual: 'report',
    mastersthesis: 'thesis', phdthesis: 'thesis', techreport: 'report', unpublished: 'manuscript',
    audio: 'song', music: 'song', recording: 'song', performance: 'speech', score: 'musical-score', misc: 'document',
  };
  return types[normalizeBibliographicType(type)] || 'document';
};

const cslAuthor = (value: unknown): Record<string, string> | null => {
  if (!value || typeof value !== 'object') return null;
  const contributor = value as Record<string, unknown>;
  if (contributor.literal) return { literal: String(contributor.literal) };
  const author: Record<string, string> = {};
  if (contributor.family) author.family = String(contributor.family);
  if (contributor.given) author.given = String(contributor.given);
  return Object.keys(author).length ? author : null;
};

export const GET: APIRoute = async ({ request, url }) => {
  const integration = authenticateIntegration(request);
  if (!integration) return Response.json({ error: 'integration_authentication_required' }, { status: 401 });

  const keys = [...url.searchParams.getAll('key'), ...String(url.searchParams.get('keys') || '').split(',')]
    .map((key) => key.trim()).filter((key) => /^[A-Za-z0-9:_-]{1,160}$/.test(key)).slice(0, 100);
  if (!keys.length) return Response.json({ items: [], missing: [] });

  try {
    const catalog = getCatalog();
    const ownerKey = integration.ownerKey || await catalog.identityOwnerForEmail(integration.email || '') || ownerKeyFor(integration.email || '');
    const references = await catalog.resolveCitationKeys(ownerKey, keys);
    const found = new Set(references.map((reference) => reference.citeKey));
    return Response.json({
      items: references.map((reference) => {
        const identifiers = reference.identifiers as Record<string, unknown>;
        const year = Number((reference.issued as Record<string, unknown> | undefined)?.year) || undefined;
        const item: Record<string, unknown> = {
          id: reference.citeKey,
          type: cslType(reference.type),
          title: reference.title,
        };
        const names = (role: string) => reference.contributors
          .filter((contributor: any) => String(contributor?.role || 'author') === role).map(cslAuthor).filter(Boolean);
        const authors = names('author'); const editors = names('editor'); const translators = names('translator'); const composers = names('composer');
        if (authors.length) item.author = authors;
        if (editors.length) item.editor = editors;
        if (translators.length) item.translator = translators;
        if (composers.length) item.composer = composers;
        if (year) item.issued = { 'date-parts': [[year]] };
        if (reference.language) item.language = reference.language;
        if (reference.publisher) item.publisher = reference.publisher;
        if (reference.publisherPlace) item['publisher-place'] = reference.publisherPlace;
        if (reference.url) item.URL = reference.url;
        if (identifiers.doi) item.DOI = Array.isArray(identifiers.doi) ? identifiers.doi[0] : identifiers.doi;
        if (identifiers.isbn) item.ISBN = Array.isArray(identifiers.isbn) ? identifiers.isbn.join(' ') : identifiers.isbn;
        return item;
      }),
      missing: keys.filter((key) => !found.has(key)),
    }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    console.error('[seshat:integration:citations:resolve]', error);
    return Response.json({ error: 'citation_resolution_failed' }, { status: 500 });
  }
};
