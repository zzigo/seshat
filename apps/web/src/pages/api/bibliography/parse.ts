import type { APIRoute } from 'astro';
import { parse } from '@retorquere/bibtex-parser';
import { inspectBibEntries } from '../../../lib/bibliography-import';

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

  const entries: any[] = [];
  const errors: unknown[] = [];
  for (const file of files) {
    const result = parse(await file.text());
    entries.push(...result.entries.map((entry) => ({ ...entry, sourceFile: file.name })));
    errors.push(...result.errors.map((error) => ({ ...error, sourceFile: file.name })));
  }
  const identity = { email: String((locals.session as any)?.user?.email || ''), name: String((locals.session as any)?.user?.name || '') };
  const inspected = await inspectBibEntries(entries, identity);
  return Response.json({
    entries: inspected.map(({ entry, attachment }) => ({ ...entry, attachment })),
    errors,
    storage: {
      linked: inspected.filter((item) => item.attachment?.status === 'linked').length,
      missing: inspected.filter((item) => item.attachment?.status === 'missing').length,
      withoutAttachment: inspected.filter((item) => !item.attachment).length,
      unavailable: inspected.filter((item) => item.attachment?.status === 'storage-unavailable').length,
    },
  });
};
