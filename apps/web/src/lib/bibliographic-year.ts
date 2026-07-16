import { parsePublicationYear } from '@seshat/core';

export type BibliographicYearCandidate = {
  year: number;
  provider: 'source-date' | 'crossref' | 'openalex' | 'open-library' | 'google-books';
  label: string;
  evidence: string;
  confidence: number;
  originalWorkYear: boolean;
  url?: string;
};

type YearReference = {
  type?: string;
  issued?: Record<string, unknown>;
  identifiers?: Record<string, unknown>;
  source?: Record<string, any>;
};

const explicitDateValues = (reference: YearReference): Array<{ label: string; value: string }> => {
  const source = reference.source || {};
  return [
    { label: source.provider === 'zotero' ? 'Zotero date' : 'Stored date', value: String(reference.issued?.literal || '') },
    { label: 'BibTeX year', value: String(source.bibtex?.year || '') },
    { label: 'BibLaTeX date', value: String(source.bibtex?.date || source.biblatexFields?.date || '') },
  ].filter((item) => item.value.trim());
};

const hasUnambiguousYear = (value: string): boolean => /-\d{1,4}|\d{1,4}\s*BCE?|(?:^|\D)\d{4}(?:\D|$)/i.test(value);

export const storedYearCandidate = (reference: YearReference): BibliographicYearCandidate | null => {
  const currentYear = parsePublicationYear(reference.issued?.year);
  for (const item of explicitDateValues(reference)) {
    if (!hasUnambiguousYear(item.value)) continue;
    const year = parsePublicationYear(item.value);
    if (year === undefined) continue;
    // A secondary import must not displace an already plausible work year.
    // The known corruption stores a calendar day/month (1-31) as the year.
    if (currentYear !== undefined && year !== currentYear && !(currentYear > 0 && currentYear <= 31)) continue;
    return {
      year,
      provider: 'source-date',
      label: item.label,
      evidence: item.value,
      confidence: 1,
      originalWorkYear: true,
    };
  }
  return null;
};

export const needsExternalYearEvidence = (reference: YearReference): boolean => {
  const current = parsePublicationYear(reference.issued?.year);
  if (current === undefined) return true;
  const doi = String(reference.identifiers?.doi || '').trim();
  const modernScholarlyType = ['article','inproceedings','conference','thesis','phdthesis','mastersthesis','report','techreport'].includes(String(reference.type || ''));
  return current > 0 && current < 100 && Boolean(doi || modernScholarlyType);
};

export const chooseYearCandidate = (
  currentYear: number | undefined,
  candidates: BibliographicYearCandidate[],
): BibliographicYearCandidate | null => {
  const distinct = [...new Map(candidates.map((candidate) => [`${candidate.provider}:${candidate.year}`, candidate])).values()]
    .filter((candidate) => candidate.year !== currentYear)
    .sort((left, right) => right.confidence - left.confidence || Number(right.originalWorkYear) - Number(left.originalWorkYear));
  return distinct[0] || null;
};

export const crossrefPublicationYear = (message: Record<string, any>): number | undefined => {
  const years = ['published-print','published','issued','published-online']
    .flatMap((field) => message?.[field]?.['date-parts'] || [])
    .map((parts: unknown[]) => Number(parts?.[0]))
    .filter((year: number) => Number.isInteger(year) && year > 0);
  return years.length ? Math.min(...years) : undefined;
};
