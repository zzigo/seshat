import {
  isValidDoi,
  isValidIsbn,
  normalizeDoi,
  normalizeIsbn,
  normalizeContributors,
  parsePublicationYear,
  potentialDuplicateFingerprint,
} from '@seshat/core';

type DuplicateReference = {
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
