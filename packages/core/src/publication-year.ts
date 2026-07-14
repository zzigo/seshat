const YEAR_TOKEN = /(?:^|[^\d])([+]?\d{1,4})(?:\s*(CE|AD))?(?=[^\d]|$)/i;
const NEGATIVE_YEAR_TOKEN = /(?:^|[^\d])(-\d{1,4})(?=[^\d]|$)/;
const BCE_YEAR_TOKEN = /(?:^|[^\d])(\d{1,4})\s*(BCE?|BC)(?=[^A-Z]|$)/i;

/** Seshat stores BCE years as negative integers (`-350` means 350 BCE). */
export const parsePublicationYear = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isInteger(value) && value !== 0 ? value : undefined;
  const text = String(value ?? '').trim();
  const negative = text.match(NEGATIVE_YEAR_TOKEN);
  if (negative) {
    const parsed = Number(negative[1]);
    return Number.isInteger(parsed) && parsed !== 0 ? parsed : undefined;
  }
  const bce = text.match(BCE_YEAR_TOKEN);
  if (bce) {
    const parsed = Number(bce[1]);
    return Number.isInteger(parsed) && parsed !== 0 ? -Math.abs(parsed) : undefined;
  }
  const match = text.match(YEAR_TOKEN);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed === 0) return undefined;
  return parsed;
};

export const isValidPublicationYear = (value: unknown, maximum = new Date().getUTCFullYear() + 1): boolean => {
  const year = typeof value === 'number' ? value : parsePublicationYear(value);
  return Number.isInteger(year) && year !== 0 && Number(year) >= -9999 && Number(year) <= maximum;
};

export const formatPublicationYear = (value: number): string => value < 0 ? `${Math.abs(value)} BCE` : String(value);
