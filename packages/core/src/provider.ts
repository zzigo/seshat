import type { BibliographicItem } from './types.js';

export interface BibliographyQuery {
  collectionId?: string;
  sinceVersion?: number;
  limit?: number;
  cursor?: string;
}

export interface BibliographyPage {
  items: BibliographicItem[];
  nextCursor?: string;
  libraryVersion?: number;
}

export interface BibliographyProvider {
  readonly name: string;
  list(query?: BibliographyQuery): Promise<BibliographyPage>;
  get(itemKey: string): Promise<BibliographicItem | null>;
}

