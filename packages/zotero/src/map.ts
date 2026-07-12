import {
  generateCiteKey,
  normalizeDoi,
  normalizeIsbn,
  type BibliographicItem,
  type BibliographicType,
  type Contributor,
  type DocumentArtifact,
} from '@seshat/core';
import type { ZoteroApiItem, ZoteroCreator, ZoteroItemData } from './types.js';

const TYPE_MAP: Record<string, BibliographicType> = {
  journalArticle: 'article',
  book: 'book',
  bookSection: 'incollection',
  conferencePaper: 'inproceedings',
  thesis: 'phdthesis',
  report: 'techreport',
  webpage: 'misc',
  blogPost: 'misc',
  manuscript: 'unpublished',
  film: 'misc',
  videoRecording: 'misc',
  artwork: 'misc',
  document: 'misc',
  encyclopediaArticle: 'incollection',
  dictionaryEntry: 'incollection',
  audioRecording: 'audio',
  musicScore: 'score',
};

const ROLE_MAP: Record<string, Contributor['role']> = {
  author: 'author',
  editor: 'editor',
  seriesEditor: 'editor',
  translator: 'translator',
  composer: 'composer',
  performer: 'performer',
};

function mapCreator(creator: ZoteroCreator): Contributor {
  return {
    family: creator.lastName?.trim() || undefined,
    given: creator.firstName?.trim() || undefined,
    literal: creator.name?.trim() || undefined,
    role: ROLE_MAP[creator.creatorType || ''] || 'contributor',
  };
}

function yearFromDate(value?: string): number | undefined {
  const match = value?.match(/(?:^|\D)(-?\d{4})(?:\D|$)/);
  if (!match) return undefined;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : undefined;
}

function splitIdentifiers(value?: string): string[] | undefined {
  if (!value) return undefined;
  const values = value
    .split(/[;,\n]+|\s+(?=(?:97[89])?\d[\dXx -]{8,})/)
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length ? values : undefined;
}

function citeKeyFromExtra(extra?: string): string | undefined {
  return extra?.match(/^Citation Key:\s*(\S+)\s*$/im)?.[1];
}

export function mapZoteroAttachment(
  item: ZoteroApiItem,
  now: string,
): DocumentArtifact | null {
  const data = item.data;
  if (data.itemType !== 'attachment') return null;
  const url = item.links?.enclosure?.href || item.links?.self?.href || data.url;
  return {
    id: `zotero:${item.key}`,
    kind: 'original',
    storage: {
      provider: data.linkMode === 'linked_url' ? 'external' : 'zotero',
      objectKey: item.key,
      url,
      mimeType: data.contentType,
    },
    createdAt: data.dateAdded || now,
  };
}

export function mapZoteroItem(input: {
  item: ZoteroApiItem;
  libraryType: 'users' | 'groups';
  libraryId: string;
  importedAt: string;
  attachments?: ZoteroApiItem[];
}): BibliographicItem {
  const { item, libraryType, libraryId, importedAt } = input;
  const data: ZoteroItemData = item.data;
  const contributors = (data.creators || []).map(mapCreator);
  const issued = { year: yearFromDate(data.date), literal: data.date || undefined };
  const normalizedIsbn = splitIdentifiers(data.ISBN)
    ?.map(normalizeIsbn)
    .filter((value): value is string => Boolean(value));
  const citeKey = citeKeyFromExtra(data.extra) || generateCiteKey({
    contributors,
    issued,
    title: data.title,
  });
  const artifacts = (input.attachments || [])
    .map((attachment) => mapZoteroAttachment(attachment, importedAt))
    .filter((artifact): artifact is DocumentArtifact => Boolean(artifact));

  return {
    id: `zotero:${libraryType}:${libraryId}:${item.key}`,
    citeKey,
    type: TYPE_MAP[data.itemType || ''] || 'misc',
    title: data.title?.trim() || '',
    contributors,
    issued,
    publisher: data.publisher?.trim() || undefined,
    publisherPlace: data.place?.trim() || undefined,
    containerTitle: data.publicationTitle || data.bookTitle || data.proceedingsTitle || undefined,
    volume: data.volume || undefined,
    issue: data.issue || undefined,
    page: data.pages || undefined,
    edition: data.edition || undefined,
    abstract: data.abstractNote || undefined,
    language: data.language || undefined,
    identifiers: {
      doi: normalizeDoi(data.DOI),
      isbn: normalizedIsbn,
      issn: splitIdentifiers(data.ISSN),
      url: data.url || undefined,
    },
    tags: (data.tags || []).map((tag) => tag.tag?.trim()).filter((tag): tag is string => Boolean(tag)),
    source: {
      provider: 'zotero',
      libraryId: `${libraryType}:${libraryId}`,
      itemKey: item.key,
      version: item.version ?? data.version,
      importedAt,
      rawType: data.itemType,
    },
    artifacts,
    createdAt: data.dateAdded || importedAt,
    updatedAt: data.dateModified || importedAt,
  };
}
