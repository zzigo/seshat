export type ReferenceVisualKind = 'pdf' | 'djvu' | 'ebook' | 'text' | 'no-text';

export const referenceVisualKind = (format: string, hasText = false): ReferenceVisualKind => {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized === 'pdf') return 'pdf';
  if (normalized === 'djvu' || normalized === 'djv') return 'djvu';
  if (['epub', 'mobi', 'azw', 'azw3'].includes(normalized)) return 'ebook';
  if (normalized === 'webarchive' || hasText || ['txt', 'md', 'rtf'].includes(normalized)) return 'text';
  return 'no-text';
};
