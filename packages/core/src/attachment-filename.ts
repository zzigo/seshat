const safePart = (value: unknown): string => String(value || '')
  .normalize('NFC')
  .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/[. ]+$/g, '');

const contributorName = (contributor: any): string => safePart(
  contributor?.family || contributor?.literal || contributor?.given || '',
);

export const firstCreator = (contributors: unknown[]): string => {
  const list = (Array.isArray(contributors) ? contributors : []) as any[];
  const authors = list.filter((person) => !person?.role || person.role === 'author');
  const creators = (authors.length ? authors : list).map(contributorName).filter(Boolean);
  if (creators.length > 2) return `${creators[0]} et al.`;
  if (creators.length === 2) return `${creators[0]} and ${creators[1]}`;
  return creators[0] || '';
};

export const zoteroStyleAttachmentName = (input: {
  contributors: unknown[];
  issued?: Record<string, unknown>;
  title: string;
  currentFilename: string;
}): string => {
  const extension = input.currentFilename.match(/\.[a-z0-9]{1,10}$/i)?.[0].toLowerCase() || '';
  const creator = firstCreator(input.contributors);
  const year = safePart(input.issued?.year).slice(0, 4);
  const title = [...safePart(input.title)].slice(0, 100).join('');
  const stem = [creator, year, title].filter(Boolean).join('_') || 'Untitled reference';
  return `${stem}${extension}`;
};
