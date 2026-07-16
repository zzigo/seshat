const CONNECTORS = new Set([
  'a', 'al', 'and', 'as', 'at', 'by', 'con', 'da', 'das', 'de', 'del', 'der', 'des', 'di', 'do', 'dos',
  'e', 'el', 'en', 'et', 'for', 'from', 'i', 'in', 'la', 'las', 'le', 'les', 'los', 'of', 'on', 'o',
  'or', 'para', 'per', 'por', 'the', 'to', 'u', 'und', 'von', 'with', 'y',
]);
const ACRONYMS = new Set([
  'AI', 'API', 'CPU', 'DNA', 'DOI', 'EU', 'GPU', 'HTTP', 'HTTPS', 'ISBN', 'JSON', 'LLM', 'MIDI',
  'MIT', 'NASA', 'NATO', 'NLP', 'OCR', 'PDF', 'RNA', 'SARS', 'SQL', 'TTS', 'UI', 'UK', 'UNESCO',
  'USA', 'UX', 'XML',
]);
const ROMAN = /^(?=[IVXLCDM]+$)M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/u;

export const isAllCapsText = (value: unknown): boolean => {
  const letters = [...String(value || '')].filter((character) => /\p{L}/u.test(character));
  return letters.length >= 2 && letters.every((character) => character === character.toLocaleUpperCase());
};

export const fixAllCapsCase = (value: unknown): string => {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!isAllCapsText(source)) return source;
  let wordIndex = 0;
  return source.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (word) => {
    const upper = word.toLocaleUpperCase();
    const first = wordIndex++ === 0;
    if (ACRONYMS.has(upper) || (ROMAN.test(upper) && upper.length <= 8)) return upper;
    const lower = word.toLocaleLowerCase();
    if (!first && CONNECTORS.has(lower)) return lower;
    return lower.replace(/\p{L}/u, (letter) => letter.toLocaleUpperCase());
  });
};
