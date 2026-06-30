export interface ZoteroCreator {
  creatorType?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
}

export interface ZoteroTag {
  tag?: string;
  type?: number;
}

export interface ZoteroItemData {
  key: string;
  version?: number;
  itemType?: string;
  parentItem?: string;
  title?: string;
  creators?: ZoteroCreator[];
  date?: string;
  publisher?: string;
  place?: string;
  publicationTitle?: string;
  bookTitle?: string;
  proceedingsTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  edition?: string;
  abstractNote?: string;
  language?: string;
  DOI?: string;
  ISBN?: string;
  ISSN?: string;
  url?: string;
  extra?: string;
  tags?: ZoteroTag[];
  dateAdded?: string;
  dateModified?: string;
  contentType?: string;
  filename?: string;
  linkMode?: string;
}

export interface ZoteroApiItem {
  key: string;
  version?: number;
  data: ZoteroItemData;
  links?: Record<string, { href?: string; type?: string }>;
}

export interface ZoteroProviderOptions {
  libraryType: 'users' | 'groups';
  libraryId: string;
  apiKey?: string;
  collectionId?: string;
  apiBaseUrl?: string;
  includeAttachments?: boolean;
  fetch?: typeof globalThis.fetch;
  now?: () => string;
}

