import type { BibliographicItem, Contributor } from './types.js';

const DOI_PATTERN = /^10\.\d{4,9}\/\S+$/i;

export function normalizeDoi(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/[\s.,;]+$/g, '')
    .toLowerCase();
  return normalized || undefined;
}

export function isValidDoi(value?: string | null): boolean {
  const normalized = normalizeDoi(value);
  return Boolean(normalized && DOI_PATTERN.test(normalized));
}

export function normalizeIsbn(value?: string | null): string | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replace(/[^0-9X]/g, '');
  return normalized || undefined;
}

function validIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const total = [...value].reduce((sum, character, index) => {
    const digit = character === 'X' ? 10 : Number(character);
    return sum + digit * (10 - index);
  }, 0);
  return total % 11 === 0;
}

function validIsbn13(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const total = [...value].reduce(
    (sum, character, index) => sum + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return total % 10 === 0;
}

export function isValidIsbn(value?: string | null): boolean {
  const normalized = normalizeIsbn(value);
  if (!normalized) return false;
  return normalized.length === 10 ? validIsbn10(normalized) : validIsbn13(normalized);
}

function slugPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 32);
}

function contributorName(contributor?: Contributor): string {
  return contributor?.family || contributor?.literal || contributor?.given || 'anon';
}

export function generateCiteKey(input: {
  contributors?: Contributor[];
  issued?: { year?: number };
  title?: string;
}): string {
  const primary = input.contributors?.find((person) => person.role === 'author')
    ?? input.contributors?.[0];
  const author = slugPart(contributorName(primary)) || 'anon';
  const year = input.issued?.year ? String(input.issued.year) : 'nd';
  const firstMeaningfulWord = (input.title || '')
    .split(/\s+/)
    .find((word) => word.length > 3 && !/^(the|this|that|with|from|para|como|dans|avec)$/i.test(word));
  const title = firstMeaningfulWord ? slugPart(firstMeaningfulWord) : '';
  return `${author}${year}${title}`;
}

export function bibliographicFingerprint(item: Pick<BibliographicItem, 'title' | 'issued' | 'contributors' | 'identifiers'>): string {
  const doi = normalizeDoi(item.identifiers.doi);
  if (doi) return `doi:${doi}`;

  const isbn = item.identifiers.isbn
    ?.map(normalizeIsbn)
    .find((value): value is string => Boolean(value && isValidIsbn(value)));
  if (isbn) return `isbn:${isbn}`;

  const author = item.contributors.find((person) => person.role === 'author');
  const identity = [
    slugPart(contributorName(author)),
    item.issued?.year ?? 'nd',
    slugPart(item.title),
  ].join(':');
  return `meta:${identity}`;
}

/**
 * Conservative key for records that are plausible duplicates. Stable
 * identifiers always qualify; metadata-only matches require a meaningful
 * title plus either an author or a publication year. Entry type is
 * intentionally excluded so the same work can be reconciled across imports
 * that classified it differently.
 */
export function potentialDuplicateFingerprint(item: Pick<BibliographicItem, 'title' | 'issued' | 'contributors' | 'identifiers'>): string | undefined {
  const doi = normalizeDoi(item.identifiers.doi);
  if (doi && isValidDoi(doi)) return `doi:${doi}`;

  const isbn = item.identifiers.isbn
    ?.map(normalizeIsbn)
    .find((value): value is string => Boolean(value && isValidIsbn(value)));
  if (isbn) return `isbn:${isbn}`;

  const title = slugPart(item.title);
  const primary = item.contributors.find((person) => person.role === 'author') ?? item.contributors[0];
  const authorName = slugPart(contributorName(primary));
  const year = item.issued?.year;
  if (title.length < 8 || (authorName === 'anon' && year === undefined)) return undefined;
  return `meta:${authorName}:${year ?? 'nd'}:${title}`;
}
