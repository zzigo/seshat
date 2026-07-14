import type { Contributor } from './types.js';

export interface SmartFolderFilters {
  author?: string;
  publisher?: string;
  publication?: string;
  place?: string;
  series?: string;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  sizeMinBytes?: number;
  sizeMaxBytes?: number;
}

export interface SmartFolderReference {
  contributors?: Contributor[];
  contributorsDisplay?: string;
  publisher?: string;
  publisherPlace?: string;
  language?: string;
  year?: number | string;
  sizeBytes?: number;
  bibliographicFields?: Record<string, string>;
}

const text = (value: unknown): string => String(value ?? '').trim().toLocaleLowerCase();
const includes = (value: unknown, query: string | undefined): boolean => !query || text(value).includes(text(query));
const finite = (value: unknown): number | undefined => {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const normalizeSmartFolderFilters = (input: unknown): SmartFolderFilters => {
  const source = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const filters: SmartFolderFilters = {};
  for (const key of ['author', 'publisher', 'publication', 'place', 'series', 'language'] as const) {
    const value = String(source[key] ?? '').trim().replace(/\s+/g, ' ').slice(0, 240);
    if (value) filters[key] = value;
  }
  for (const key of ['yearFrom', 'yearTo', 'sizeMinBytes', 'sizeMaxBytes'] as const) {
    const value = finite(source[key]);
    if (value !== undefined) filters[key] = key.startsWith('size') ? Math.max(0, value) : Math.trunc(value);
  }
  if (filters.yearFrom !== undefined && filters.yearTo !== undefined && filters.yearFrom > filters.yearTo) {
    [filters.yearFrom, filters.yearTo] = [filters.yearTo, filters.yearFrom];
  }
  if (filters.sizeMinBytes !== undefined && filters.sizeMaxBytes !== undefined && filters.sizeMinBytes > filters.sizeMaxBytes) {
    [filters.sizeMinBytes, filters.sizeMaxBytes] = [filters.sizeMaxBytes, filters.sizeMinBytes];
  }
  return filters;
};

export const smartFolderHasFilters = (filters: SmartFolderFilters): boolean => Object.keys(filters).length > 0;

export const referenceMatchesSmartFolder = (reference: SmartFolderReference, rawFilters: SmartFolderFilters): boolean => {
  const filters = normalizeSmartFolderFilters(rawFilters);
  const fields = reference.bibliographicFields || {};
  const people = reference.contributorsDisplay || (reference.contributors || []).map((person) =>
    person.literal || [person.family, person.given].filter(Boolean).join(', ')).filter(Boolean).join(' · ');
  const publication = [fields.journaltitle, fields.booktitle, fields.maintitle, fields.eventtitle].filter(Boolean).join(' · ');
  const place = reference.publisherPlace || fields.location || fields.venue || '';
  const year = finite(reference.year);
  const size = finite(reference.sizeBytes) || 0;
  return includes(people, filters.author)
    && includes(reference.publisher || fields.publisher, filters.publisher)
    && includes(publication, filters.publication)
    && includes(place, filters.place)
    && includes(fields.series, filters.series)
    && includes(reference.language || fields.language, filters.language)
    && (filters.yearFrom === undefined || (year !== undefined && year >= filters.yearFrom))
    && (filters.yearTo === undefined || (year !== undefined && year <= filters.yearTo))
    && (filters.sizeMinBytes === undefined || size >= filters.sizeMinBytes)
    && (filters.sizeMaxBytes === undefined || size <= filters.sizeMaxBytes);
};
