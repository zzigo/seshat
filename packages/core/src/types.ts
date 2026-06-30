export type BibliographicType =
  | 'article-journal'
  | 'book'
  | 'chapter'
  | 'paper-conference'
  | 'thesis'
  | 'report'
  | 'webpage'
  | 'manuscript'
  | 'motion-picture'
  | 'musical-score'
  | 'song'
  | 'entry-encyclopedia'
  | 'document';

export interface Contributor {
  family?: string;
  given?: string;
  literal?: string;
  role: 'author' | 'editor' | 'translator' | 'composer' | 'performer' | 'contributor';
}

export interface PartialDate {
  year?: number;
  month?: number;
  day?: number;
  literal?: string;
}

export interface IdentifierSet {
  doi?: string;
  isbn?: string[];
  issn?: string[];
  url?: string;
  arxiv?: string;
  other?: Record<string, string>;
}

export interface SourceIdentity {
  provider: string;
  libraryId?: string;
  itemKey: string;
  version?: number;
  importedAt: string;
  rawType?: string;
}

export type StorageProvider = 'r2' | 's3' | 'zotero' | 'filesystem' | 'external';

export interface StoredObject {
  provider: StorageProvider;
  objectKey?: string;
  url?: string;
  bucket?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  etag?: string;
}

export type DocumentArtifactKind =
  | 'original'
  | 'docling-json'
  | 'markdown'
  | 'plain-text'
  | 'chunks'
  | 'thumbnail';

export interface DocumentArtifact {
  id: string;
  kind: DocumentArtifactKind;
  storage: StoredObject;
  derivedFrom?: string;
  createdAt: string;
  parser?: {
    name: string;
    version?: string;
    optionsHash?: string;
  };
  pageCount?: number;
  language?: string;
}

export interface BibliographicItem {
  id: string;
  citeKey: string;
  type: BibliographicType;
  title: string;
  contributors: Contributor[];
  issued?: PartialDate;
  publisher?: string;
  publisherPlace?: string;
  containerTitle?: string;
  volume?: string;
  issue?: string;
  page?: string;
  edition?: string;
  abstract?: string;
  language?: string;
  identifiers: IdentifierSet;
  tags: string[];
  source: SourceIdentity;
  artifacts: DocumentArtifact[];
  createdAt: string;
  updatedAt: string;
}

export type HealthSeverity = 'error' | 'warning' | 'info';

export interface HealthIssue {
  code: string;
  severity: HealthSeverity;
  field?: string;
  message: string;
  suggestion?: string;
}

export interface HealthReport {
  itemId: string;
  score: number;
  status: 'healthy' | 'needs-attention' | 'invalid';
  fingerprint: string;
  issues: HealthIssue[];
  evaluatedAt: string;
}

