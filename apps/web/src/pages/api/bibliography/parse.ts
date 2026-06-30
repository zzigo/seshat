import type { APIRoute } from 'astro';
import { parse } from '@retorquere/bibtex-parser';

const MAX_BIB_BYTES = 10 * 1024 * 1024;

export const POST: APIRoute = async ({ request, locals }) => {
  if (!(locals.session as any)?.user?.email) {
    return Response.json({ error: 'authentication_required' }, { status: 401 });
  }
  const form = await request.formData();
  const files = form.getAll('files').filter((value): value is File => value instanceof File);
  if (!files.length) return Response.json({ error: 'No .bib files received.' }, { status: 400 });
  if (files.some((file) => file.size > MAX_BIB_BYTES || !file.name.toLowerCase().endsWith('.bib'))) {
    return Response.json({ error: 'Bibliographies must be .bib files smaller than 10 MB.' }, { status: 413 });
  }

  const entries: unknown[] = [];
  const errors: unknown[] = [];
  for (const file of files) {
    const result = parse(await file.text());
    entries.push(...result.entries.map((entry) => ({ ...entry, sourceFile: file.name })));
    errors.push(...result.errors.map((error) => ({ ...error, sourceFile: file.name })));
  }
  return Response.json({ entries, errors });
};
