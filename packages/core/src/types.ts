export const BIBLATEX_ENTRY_TYPE_OPTIONS = [
  { value: 'article', biblatex: 'article', label: 'article', description: 'Journal, magazine, newspaper, or periodical article.', family: 'standard' },
  { value: 'book', biblatex: 'book', label: 'book', description: 'Book with an identifiable publisher.', family: 'standard' },
  { value: 'booklet', biblatex: 'booklet', label: 'booklet', description: 'Bound work without a clearly identifiable publisher.', family: 'standard' },
  { value: 'conference', biblatex: 'conference', label: 'conference', description: 'Alias of inproceedings retained for compatibility.', family: 'standard' },
  { value: 'inbook', biblatex: 'inbook', label: 'inbook', description: 'Part, chapter, section, or page range within a book.', family: 'standard' },
  { value: 'incollection', biblatex: 'incollection', label: 'incollection', description: 'Titled contribution within an edited collection.', family: 'standard' },
  { value: 'inproceedings', biblatex: 'inproceedings', label: 'inproceedings', description: 'Paper published in conference proceedings.', family: 'standard' },
  { value: 'manual', biblatex: 'manual', label: 'manual', description: 'Technical or software manual.', family: 'standard' },
  { value: 'mastersthesis', biblatex: 'mastersthesis', label: 'mastersthesis', description: 'Master-level thesis.', family: 'standard' },
  { value: 'misc', biblatex: 'misc', label: 'misc', description: 'Source not adequately covered by another type.', family: 'standard' },
  { value: 'phdthesis', biblatex: 'phdthesis', label: 'phdthesis', description: 'Doctoral thesis.', family: 'standard' },
  { value: 'proceedings', biblatex: 'proceedings', label: 'proceedings', description: 'Published conference proceedings as a whole.', family: 'standard' },
  { value: 'techreport', biblatex: 'techreport', label: 'techreport', description: 'Institutional, technical, government, or working report.', family: 'standard' },
  { value: 'unpublished', biblatex: 'unpublished', label: 'unpublished', description: 'Draft, manuscript, or work not formally published.', family: 'standard' },
  { value: 'audio', biblatex: 'audio', label: 'audio', description: 'BibLaTeX/Biber audio recording; standard styles use the misc driver.', family: 'biblatex' },
  { value: 'music', biblatex: 'music', label: 'music', description: 'BibLaTeX/Biber musical recording; a specialized audio entry.', family: 'biblatex' },
  { value: 'performance', biblatex: 'performance', label: 'performance', description: 'BibLaTeX/Biber live musical, theatrical, or performing-arts event.', family: 'biblatex' },
  { value: 'recording', biblatex: 'recording', label: 'recording', description: 'Seshat/Biber extension for a published recording.', family: 'extension' },
  { value: 'score', biblatex: 'misc', label: 'score → @misc', description: 'Seshat convenience type exported portably as @misc with howpublished=Musical score.', family: 'alias' },
] as const;

export type BibliographicType = typeof BIBLATEX_ENTRY_TYPE_OPTIONS[number]['value'];
export const BIBLATEX_ENTRY_TYPE_VALUES: readonly BibliographicType[] = BIBLATEX_ENTRY_TYPE_OPTIONS.map((option) => option.value);

export const BIBLATEX_FIELD_OPTIONS = [
  { key:'title', label:'Title', group:'Identity', core:true, types:'all' },
  { key:'subtitle', label:'Subtitle', group:'Identity', types:'all' },
  { key:'titleaddon', label:'Title add-on', group:'Identity', types:'all' },
  { key:'shorttitle', label:'Short title', group:'Identity', types:'all' },
  { key:'year', label:'Year', group:'Date', core:true, types:'all' },
  { key:'month', label:'Month', group:'Date', types:'all' },
  { key:'date', label:'Date', group:'Date', types:['audio','music','performance','recording','misc','unpublished'] },
  { key:'journaltitle', label:'Journal title', group:'Publication', types:['article'] },
  { key:'booktitle', label:'Book / proceedings title', group:'Publication', types:['inbook','incollection','inproceedings','conference'] },
  { key:'maintitle', label:'Main title', group:'Publication', types:['inbook','incollection'] },
  { key:'eventtitle', label:'Event title', group:'Publication', types:['inproceedings','conference','proceedings','performance'] },
  { key:'eventdate', label:'Event date', group:'Publication', types:['inproceedings','conference','proceedings','performance'] },
  { key:'venue', label:'Venue', group:'Publication', types:['inproceedings','conference','proceedings','performance','recording','audio','music'] },
  { key:'publisher', label:'Publisher', group:'Publication', core:true, types:['article','book','inbook','incollection','inproceedings','conference','proceedings','audio','music','recording','score','misc'] },
  { key:'location', label:'Location / address', group:'Publication', core:true, types:'all' },
  { key:'institution', label:'Institution', group:'Publication', types:['techreport'] },
  { key:'organization', label:'Organization', group:'Publication', types:['manual','proceedings','inproceedings','conference'] },
  { key:'school', label:'School', group:'Publication', types:['mastersthesis','phdthesis'] },
  { key:'series', label:'Series', group:'Publication', types:['article','book','inbook','incollection','inproceedings','conference','proceedings','audio','music','recording','score'] },
  { key:'volume', label:'Volume', group:'Part', types:['article','book','inbook','incollection','inproceedings','conference','proceedings','audio','music','recording','score'] },
  { key:'number', label:'Number', group:'Part', types:['article','book','inbook','incollection','inproceedings','conference','proceedings','techreport','audio','music','recording','score'] },
  { key:'issue', label:'Issue', group:'Part', types:['article'] },
  { key:'edition', label:'Edition', group:'Part', types:['book','inbook','incollection','manual','score'] },
  { key:'chapter', label:'Chapter', group:'Part', types:['inbook','incollection'] },
  { key:'pages', label:'Pages', group:'Part', types:['article','inbook','incollection','inproceedings','conference'] },
  { key:'pagetotal', label:'Total pages', group:'Part', types:['book','proceedings','manual','mastersthesis','phdthesis','techreport'] },
  { key:'version', label:'Version', group:'Part', types:['manual','misc','audio','music','recording'] },
  { key:'type', label:'Work / medium type', group:'Format', types:['mastersthesis','phdthesis','techreport','audio','music','performance','recording','misc','score'] },
  { key:'howpublished', label:'How published', group:'Format', types:['booklet','misc','unpublished','score','audio','music','recording'] },
  { key:'entrysubtype', label:'Entry subtype', group:'Format', types:'all' },
  { key:'doi', label:'DOI', group:'Identifiers', types:['article','book','inbook','incollection','inproceedings','conference','proceedings','techreport'] },
  { key:'isbn', label:'ISBN', group:'Identifiers', core:true, types:['book','inbook','incollection','proceedings','manual','score'] },
  { key:'issn', label:'ISSN', group:'Identifiers', types:['article','proceedings','audio','music','recording'] },
  { key:'eprint', label:'E-print identifier', group:'Identifiers', types:['article','unpublished','techreport','misc'] },
  { key:'eprinttype', label:'E-print type', group:'Identifiers', types:['article','unpublished','techreport','misc'] },
  { key:'userd', label:'Catalog / recording number', group:'Identifiers', types:['audio','music','recording','score'] },
  { key:'url', label:'URL', group:'Access', core:true, types:'all' },
  { key:'urldate', label:'Access date', group:'Access', types:'all' },
  { key:'language', label:'Language', group:'Description', core:true, types:'all' },
  { key:'abstract', label:'Abstract', group:'Description', core:true, types:'all' },
  { key:'note', label:'Note', group:'Description', types:'all' },
  { key:'annotation', label:'Annotation', group:'Description', types:'all' },
] as const;

export type BiblatexFieldKey = typeof BIBLATEX_FIELD_OPTIONS[number]['key'];
export const BIBLATEX_FIELD_KEYS: readonly BiblatexFieldKey[] = BIBLATEX_FIELD_OPTIONS.map((field) => field.key);
export const biblatexFieldsFor = (value: unknown) => {
  const type = normalizeBibliographicType(value);
  return BIBLATEX_FIELD_OPTIONS.filter((field) => field.types === 'all' || (field.types as readonly string[]).includes(type));
};

const LEGACY_BIBLIOGRAPHIC_TYPES: Record<string, BibliographicType> = {
  document: 'misc', article: 'article', 'article-journal': 'article', book: 'book', chapter: 'incollection',
  'paper-conference': 'inproceedings', thesis: 'phdthesis', report: 'techreport', webpage: 'misc',
  manuscript: 'unpublished', 'motion-picture': 'misc', 'musical-score': 'score', song: 'music',
  'entry-encyclopedia': 'incollection',
};

export const normalizeBibliographicType = (value: unknown): BibliographicType => {
  const normalized = String(value || '').trim().toLowerCase();
  return BIBLATEX_ENTRY_TYPE_VALUES.includes(normalized as BibliographicType)
    ? normalized as BibliographicType
    : LEGACY_BIBLIOGRAPHIC_TYPES[normalized] || 'misc';
};

export const biblatexEntryTypeFor = (value: unknown): string => {
  const type = normalizeBibliographicType(value);
  return BIBLATEX_ENTRY_TYPE_OPTIONS.find((option) => option.value === type)?.biblatex || 'misc';
};

export interface Contributor {
  family?: string;
  given?: string;
  literal?: string;
  role: 'author' | 'editor' | 'translator' | 'composer' | 'performer' | 'curator' | 'producer' | 'director' | 'conductor' | 'commentator' | 'annotator' | 'introduction' | 'foreword' | 'afterword' | 'contributor';
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

export type StorageProvider = 'wasabi' | 'wasabi-linked' | 's3' | 'zotero' | 'filesystem' | 'external';

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
