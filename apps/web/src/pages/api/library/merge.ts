import { potentialDuplicateFingerprint, type BibliographicItem } from '@seshat/core';
import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';

const fingerprintFor = (reference: any): string | undefined => {
  const identifiers = reference.identifiers && typeof reference.identifiers === 'object' ? { ...reference.identifiers } : {};
  identifiers.doi ||= reference.source?.biblatexFields?.doi || reference.source?.bibtex?.doi;
  return potentialDuplicateFingerprint({
    title: String(reference.title || ''),
    issued: reference.issued && typeof reference.issued === 'object' ? reference.issued : undefined,
    contributors: Array.isArray(reference.contributors) ? reference.contributors : [],
    identifiers,
  } as Pick<BibliographicItem, 'title' | 'issued' | 'contributors' | 'identifiers'>);
};

export const POST: APIRoute = async ({ request, locals }) => {
  const email = String((locals.session as any)?.user?.email || '').trim().toLowerCase();
  if (!email) return Response.json({ error: 'authentication_required' }, { status: 401 });
  const body = await request.json().catch(() => null) as { keepId?: unknown; duplicateIds?: unknown } | null;
  const keepId = String(body?.keepId || '').trim();
  const duplicateIds = Array.isArray(body?.duplicateIds)
    ? [...new Set(body.duplicateIds.map((id) => String(id || '').trim()).filter((id) => id && id !== keepId))].slice(0, 49)
    : [];
  if (!keepId || !duplicateIds.length) return Response.json({ error: 'merge_requires_at_least_two_items' }, { status: 400 });

  const catalog = getCatalog();
  const ownerKey = ownerKeyFor(email);
  const references = await Promise.all([keepId, ...duplicateIds].map((id) => catalog.get(ownerKey, id)));
  if (references.some((reference) => !reference || reference.access !== 'owner')) {
    return Response.json({ error: 'reference_not_found' }, { status: 404 });
  }
  const fingerprints = references.map(fingerprintFor);
  if (!fingerprints[0] || fingerprints.some((fingerprint) => fingerprint !== fingerprints[0])) {
    return Response.json({ error: 'items_are_not_one_duplicate_group' }, { status: 409 });
  }

  try {
    const reference = await catalog.mergeReferences(ownerKey, keepId, duplicateIds);
    return Response.json({ ok: true, reference, removedIds: duplicateIds });
  } catch (error) {
    console.error('[seshat:merge-duplicates]', error);
    return Response.json({ error: error instanceof Error ? error.message : 'duplicate_merge_failed' }, { status: 500 });
  }
};
