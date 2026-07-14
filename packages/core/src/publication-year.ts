const YEAR_TOKEN = /(?:^|[^\d])([+-]?\d{1,4})(?:\s*(BCE?|BC|CE|AD))?(?=[^\d]|$)/i;

/** Seshat stores BCE years as negative integers (`-350` means 350 BCE). */
export const parsePublicationYear = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isInteger(value) && value !== 0 ? value : undefined;
  const match = String(value ?? '').trim().match(YEAR_TOKEN);
  if (!match) return undefined;
  const era = String(match[2] || '').toUpperCase();
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed) || parsed === 0) return undefined;
  return era === 'BC' || era === 'BCE' ? -Math.abs(parsed) : parsed;
};

export const isValidPublicationYear = (value: unknown, maximum = new Date().getUTCFullYear() + 1): boolean => {
  const year = typeof value === 'number' ? value : parsePublicationYear(value);
  return Number.isInteger(year) && year !== 0 && Number(year) >= -9999 && Number(year) <= maximum;
};

export const formatPublicationYear = (value: number): string => value < 0 ? `${Math.abs(value)} BCE` : String(value);
