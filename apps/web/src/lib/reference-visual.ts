export type ReferenceVisualKind = 'pdf' | 'djvu' | 'ebook' | 'text' | 'no-text';
export type BibliographicVisualKind = 'paper' | 'book' | 'score' | 'recording' | 'performance' | 'thesis' | 'report' | 'misc';
export type ReferenceProcessKind = 'openalex' | 'annotation' | 'text' | 'structure';
export type ReferenceLinkState = 'linked' | 'unlinked';

export const referenceVisualKind = (format: string, hasText = false): ReferenceVisualKind => {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized === 'pdf') return 'pdf';
  if (normalized === 'djvu' || normalized === 'djv') return 'djvu';
  if (['epub', 'mobi', 'azw', 'azw3'].includes(normalized)) return 'ebook';
  if (normalized === 'webarchive' || hasText || ['txt', 'md', 'rtf'].includes(normalized)) return 'text';
  return 'no-text';
};

export const bibliographicVisualKind = (value: unknown): BibliographicVisualKind => {
  const type = String(value || '').trim().toLowerCase();
  if (['article','conference','inproceedings','proceedings'].includes(type)) return 'paper';
  if (['book','booklet','inbook','incollection'].includes(type)) return 'book';
  if (type === 'score') return 'score';
  if (['audio','music','recording'].includes(type)) return 'recording';
  if (type === 'performance') return 'performance';
  if (['mastersthesis','phdthesis'].includes(type)) return 'thesis';
  if (['manual','techreport'].includes(type)) return 'report';
  return 'misc';
};

export const bibliographicVisualLabel = (kind: BibliographicVisualKind): string => ({
  paper:'Paper / article',book:'Book / chapter',score:'Musical score',recording:'Audio / recording',performance:'Performance',thesis:'Thesis',report:'Report / manual',misc:'Other document',
})[kind];

export const referenceProcessKinds = (state: { hasOpenAlex?:boolean;hasAnnotations?:boolean;hasText?:boolean;hasStructure?:boolean }): ReferenceProcessKind[] => [
  state.hasOpenAlex ? 'openalex' : null,
  state.hasAnnotations ? 'annotation' : null,
  state.hasText ? 'text' : null,
  state.hasStructure ? 'structure' : null,
].filter((kind): kind is ReferenceProcessKind => Boolean(kind));
export const referenceProcessLabel = (kind: ReferenceProcessKind): string => ({openalex:'OpenAlex indexed',annotation:'Annotated',text:'Text extracted',structure:'Structure extracted'})[kind];
export const referenceLinkState = (state: { hasOriginal?:boolean }): ReferenceLinkState => state.hasOriginal ? 'linked' : 'unlinked';
