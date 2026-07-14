import {
  isValidDoi,
  isValidIsbn,
  normalizeDoi,
  normalizeIsbn,
  normalizeContributors,
  parsePublicationYear,
  potentialDuplicateFingerprint,
} from '@seshat/core';

export type DuplicateReference = {
  title?: unknown;
  issued?: unknown;
  contributors?: unknown;
  identifiers?: unknown;
  source?: unknown;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown>
  : {};

const values = (value: unknown): string[] => (Array.isArray(value) ? value : [value])
  .flatMap((current) => String(current ?? '').split(/[;\n]+/))
  .map((current) => current.trim())
  .filter(Boolean);

const stableEvidence = (reference: DuplicateReference): Set<string> => {
  const identifiers = record(reference.identifiers);
  const source = record(reference.source);
  const biblatex = record(source.biblatexFields);
  const bibtex = record(source.bibtex);
  const dois = [
    ...values(identifiers.doi),
    ...values(biblatex.doi),
    ...values(bibtex.doi),
  ];
  const isbns = [
    ...values(identifiers.isbn),
    ...values(biblatex.isbn),
    ...values(bibtex.isbn),
  ];
  return new Set([
    ...dois.map(normalizeDoi).filter((value): value is string => Boolean(value && isValidDoi(value))).map((value) => `doi:${value}`),
    ...isbns.map(normalizeIsbn).filter((value): value is string => Boolean(value && isValidIsbn(value))).map((value) => `isbn:${value}`),
  ]);
};

const metadataEvidence = (reference: DuplicateReference): string | undefined => {
  const year = parsePublicationYear(record(reference.issued).year);
  return potentialDuplicateFingerprint({
    title: String(reference.title || ''),
    issued: year === undefined ? undefined : { year },
    contributors: normalizeContributors(Array.isArray(reference.contributors) ? reference.contributors : []),
    identifiers: {},
  });
};

export const duplicateEvidenceKeys = (reference: DuplicateReference): Set<string> => {
  const result = stableEvidence(reference);
  const metadata = metadataEvidence(reference);
  if (metadata) result.add(metadata);
  return result;
};

/**
 * Merge validation accepts a stable identifier found in any trustworthy
 * metadata representation. If only one side has a stable identifier, the
 * conservative author/year/title fingerprint may still bridge the records.
 * Conflicting stable identifiers cannot be bridged by metadata alone.
 */
export const referencesShareDuplicateEvidence = (references: DuplicateReference[]): boolean => {
  if (references.length < 2) return false;
  const stable = references.map(stableEvidence);
  const commonStable = [...stable[0]].some((key) => stable.every((keys) => keys.has(key)));
  if (commonStable) return true;

  const distinctStable = new Set(stable.flatMap((keys) => [...keys]));
  if (distinctStable.size > 1) return false;
  const metadata = references.map(metadataEvidence);
  return Boolean(metadata[0] && metadata.every((key) => key === metadata[0]));
};

export type InboxZoteroDuplicateCandidate = DuplicateReference & {
  id: string;
  isInbox: boolean;
  isZotero: boolean;
};

export type InboxZoteroDuplicateMerge = { keepId: string; duplicateId: string };

/** Plans only unambiguous Inbox -> Zotero merges. An Inbox record that can
 * match more than one Zotero record stays in Duplicated for manual review. */
export const planInboxZoteroDuplicateMerges = (
  references: InboxZoteroDuplicateCandidate[],
): InboxZoteroDuplicateMerge[] => {
  const zotero = references.filter((reference) => reference.isZotero);
  const zoteroByKey = new Map<string, InboxZoteroDuplicateCandidate[]>();
  for (const reference of zotero) for (const key of duplicateEvidenceKeys(reference)) {
    zoteroByKey.set(key, [...(zoteroByKey.get(key) || []), reference]);
  }

  const result: InboxZoteroDuplicateMerge[] = [];
  for (const inbox of references.filter((reference) => reference.isInbox)) {
    const candidates = new Map<string, InboxZoteroDuplicateCandidate>();
    for (const key of duplicateEvidenceKeys(inbox)) {
      for (const reference of zoteroByKey.get(key) || []) candidates.set(reference.id, reference);
    }
    const confirmed = [...candidates.values()].filter((reference) => referencesShareDuplicateEvidence([reference, inbox]));
    if (confirmed.length === 1) result.push({ keepId: confirmed[0].id, duplicateId: inbox.id });
  }
  return result;
};
