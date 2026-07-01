import { createHash, randomUUID } from 'node:crypto';
import { parse } from '@retorquere/bibtex-parser';
import type { APIRoute } from 'astro';
import type { CatalogBibliographyInput } from '@seshat/catalog';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const MAX_BIB_BYTES = 10 * 1024 * 1024;
const bibType = (value: string): string => ({
  article: 'article-journal', book: 'book', inbook: 'chapter', incollection: 'chapter',
  inproceedings: 'paper-conference', conference: 'paper-conference', proceedings: 'book',
  phdthesis: 'thesis', mastersthesis: 'thesis', techreport: 'report',
}[value.toLowerCase()] || 'document');
const literal = (value: unknown): string => Array.isArray(value) ? value.map(String).join('; ') : String(value || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const files = form?.getAll('files').filter((value): value is File => value instanceof File) || [];
  if (!files.length) return Response.json({ error: 'No .bib files received.' }, { status: 400 });
  if (files.some((file) => file.size > MAX_BIB_BYTES || !file.name.toLowerCase().endsWith('.bib'))) {
    return Response.json({ error: 'Bibliographies must be .bib files smaller than 10 MB.' }, { status: 413 });
  }

  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  let libraryId = String(form?.get('libraryId') || '').trim();
  let library = libraryId ? (await catalog.listLibraries(ownerKey)).find((item) => item.id === libraryId) : undefined;
  if (!library) {
    const fallback = files.length === 1 ? files[0].name.replace(/\.bib$/i, '') : `BibTeX import ${new Date().toISOString().slice(0, 10)}`;
    const requested = String(form?.get('libraryName') || '').trim().replace(/\s+/g, ' ') || fallback;
    const parentId = String(form?.get('parentId') || '').trim() || undefined;
    let name = requested.slice(0, 160);
    try { library = await catalog.createLibrary(ownerKey, name, parentId); }
    catch (error: any) {
      if (String(error?.code || '') !== '23505') throw error;
      name = `${name.slice(0, 140)} · ${new Date().toLocaleString('sv').replace(/[: ]/g, '-')}`;
      library = await catalog.createLibrary(ownerKey, name, parentId);
    }
    libraryId = library.id;
  }

  const entries: CatalogBibliographyInput[] = [];
  const errors: unknown[] = [];
  for (const file of files) {
    const result = parse(await file.text());
    errors.push(...result.errors.map((error) => ({ ...error, sourceFile: file.name })));
    for (const entry of result.entries) {
      const fields = (entry.fields || {}) as Record<string, any>;
      const contributors = (Array.isArray(fields.author) ? fields.author : []).map((person: any) => ({
        family: String(person.lastName || ''), given: String(person.firstName || ''), role: 'author',
      })).filter((person: any) => person.family || person.given);
      const year = Number(String(fields.year || '').match(/\d{4}/)?.[0]) || undefined;
      const isbn = literal(fields.isbn).split(/[;,\s]+/).filter(Boolean);
      const doi = literal(fields.doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
      const input = String((entry as any).input || JSON.stringify(entry));
      entries.push({
        id: randomUUID(), citeKey: String(entry.key || `import-${randomUUID().slice(0, 8)}`).slice(0, 160),
        type: bibType(String(entry.type || 'document')), title: literal(fields.title) || 'Untitled reference',
        contributors, issued: year ? { year } : undefined,
        identifiers: { ...(isbn.length ? { isbn } : {}), ...(doi ? { doi } : {}) },
        tags: [], abstract: literal(fields.abstract) || undefined, language: literal(fields.language) || undefined,
        source: { provider: 'bibtex', sourceFile: file.name, importedAt: new Date().toISOString(), bibtex: fields, raw: input },
        originalSha256: createHash('sha256').update(`bibtex\0${input}`).digest('hex'),
      });
    }
  }
  const references = await catalog.importBibliography(ownerKey, libraryId, entries);
  return Response.json({ ok: true, library, imported: references.length, references, errors }, { status: 201 });
};
