import { parse } from '@retorquere/bibtex-parser';
import type { APIRoute } from 'astro';
import { catalogInputForBibEntry, inspectBibEntries } from '../../../lib/bibliography-import';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const MAX_BIB_BYTES = 10 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = (locals.session as any)?.user;
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const files = form?.getAll('files').filter((value): value is File => value instanceof File) || [];
  if (!files.length) return Response.json({ error: 'No .bib files received.' }, { status: 400 });
  if (files.some((file) => file.size > MAX_BIB_BYTES || !file.name.toLowerCase().endsWith('.bib'))) {
    return Response.json({ error: 'Bibliographies must be .bib files smaller than 10 MB.' }, { status: 413 });
  }

  const parsed: Array<{ entry: any; sourceFile: string }> = [];
  const errors: unknown[] = [];
  for (const file of files) {
    const result = parse(await file.text());
    parsed.push(...result.entries.map((entry) => ({ entry, sourceFile: file.name })));
    errors.push(...result.errors.map((error) => ({ ...error, sourceFile: file.name })));
  }
  const inspected = await inspectBibEntries(parsed.map((item) => item.entry), { email, name: String(user?.name || '') });
  const ownerKey = ownerKeyFor(email);
  const catalog = getCatalog();
  const fallbackName = String(form?.get('libraryName') || '').trim().replace(/\s+/g, ' ')
    || (files.length === 1 ? files[0].name.replace(/\.bib$/i, '') : `BibTeX import ${new Date().toISOString().slice(0, 10)}`);
  const groups = new Map<string, { directories: string[]; entries: Array<{ inspected: typeof inspected[number]; sourceFile: string }> }>();
  inspected.forEach((item, index) => {
    const directories = item.attachment?.directories.length ? item.attachment.directories : [fallbackName];
    const key = JSON.stringify(directories);
    const group = groups.get(key) || { directories, entries: [] };
    group.entries.push({ inspected: item, sourceFile: parsed[index].sourceFile });
    groups.set(key, group);
  });

  const references = [];
  const libraries = [];
  try {
    for (const group of groups.values()) {
      const library = await catalog.ensureLibraryPath(ownerKey, group.directories);
      if (!library) throw new Error('LIBRARY_PATH_CREATE_FAILED');
      libraries.push(library);
      const imported = await catalog.importBibliography(ownerKey, library.id,
        group.entries.map(({ inspected: item, sourceFile }) => catalogInputForBibEntry(item, sourceFile)));
      references.push(...imported);
    }
  } catch(error) {
    const message=error instanceof Error?error.message:'BIBLIOGRAPHY_IMPORT_FAILED';console.error('[seshat:bibliography-import]',error);
    return Response.json({error:message==='WASABI_OBJECT_ALREADY_LINKED'?'A linked file belongs to another catalog item and could not be merged.':message},{status:message==='WASABI_OBJECT_ALREADY_LINKED'?409:500});
  }
  return Response.json({
    ok: true, imported: references.length, references, libraries, errors,
    linked: inspected.filter((item) => item.attachment?.status === 'linked').length,
    missing: inspected.filter((item) => item.attachment?.status === 'missing').map((item) => item.attachment?.relativePath),
    unavailable: inspected.filter((item) => item.attachment?.status === 'storage-unavailable').length,
  }, { status: 201 });
};
