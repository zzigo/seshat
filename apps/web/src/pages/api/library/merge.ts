import type { APIRoute } from 'astro';
import { getCatalog, ownerKeyFor } from '../../../lib/catalog';
import { referencesShareDuplicateEvidence } from '../../../lib/duplicate-match';

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
  const ownedReferences = references.filter((reference): reference is NonNullable<typeof reference> => Boolean(reference && reference.access === 'owner'));
  if (ownedReferences.length !== references.length) {
    return Response.json({ error: 'reference_not_found' }, { status: 404 });
  }
  if (!referencesShareDuplicateEvidence(ownedReferences)) {
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
