export type ReadingLocation = Record<string, unknown> & {
  page?: number;
  lastPage?: number;
  totalPages?: number;
  fraction?: number;
  progress?: number;
  cfi?: string;
  sectionIndex?: number;
  completedAt?: string;
};

export const READING_COMPLETE_THRESHOLD = .995;

const finiteNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const readingProgress = (location: ReadingLocation | null | undefined) => {
  if (!location) return 0;
  const explicit = finiteNumber(location.progress);
  const fraction = finiteNumber(location.fraction);
  const page = finiteNumber(location.lastPage ?? location.page);
  const total = finiteNumber(location.totalPages);
  const value = explicit ?? fraction ?? (page !== null && total && total > 0 ? page / total : 0);
  return Math.max(0, Math.min(1, value || 0));
};

export const readingProgressPercent = (location: ReadingLocation | null | undefined) => Math.round(readingProgress(location) * 100);

export const updateReadingLocation = (
  previous: ReadingLocation | null | undefined,
  next: ReadingLocation,
  completedAt = new Date().toISOString(),
): ReadingLocation => {
  const merged = { ...(previous || {}), ...next };
  const hasFreshPosition = ['fraction','page','lastPage','totalPages'].some((key) => Object.prototype.hasOwnProperty.call(next,key));
  if (hasFreshPosition && !Object.prototype.hasOwnProperty.call(next,'progress')) delete merged.progress;
  const progress = readingProgress(merged);
  const result: ReadingLocation = { ...merged, progress };
  if (previous?.completedAt || next.completedAt) result.completedAt = String(previous?.completedAt || next.completedAt);
  else if (progress >= READING_COMPLETE_THRESHOLD) result.completedAt = completedAt;
  return result;
};

export const readingIsComplete = (location: ReadingLocation | null | undefined) => Boolean(location?.completedAt) || readingProgress(location) >= READING_COMPLETE_THRESHOLD;
