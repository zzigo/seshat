type FileReference = {
  source?: Record<string, unknown>;
  artifacts?: Array<{ kind?: string; mimeType?: string }>;
};

const mimeExtensions: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/epub+zip': 'epub',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/rtf': 'rtf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/vnd.oasis.opendocument.text': 'odt',
};

export const referenceFileType = (reference: FileReference): string => {
  const filename = String(reference.source?.originalFilename || '').trim();
  const match = filename.match(/\.([a-z0-9]{1,12})$/i);
  if (match) return match[1].toLowerCase();
  const mime = String(reference.artifacts?.find((artifact) => artifact.kind === 'original')?.mimeType || '').split(';')[0].toLowerCase();
  return mimeExtensions[mime] || '';
};
