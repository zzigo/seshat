export type RecentlyReadRecord = { lastReadAt?: string | null };

export const lastReadTimestamp = (value: unknown): number => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const sortRecentlyRead = <T extends RecentlyReadRecord>(records: T[]): T[] => records
  .filter((record) => lastReadTimestamp(record.lastReadAt) > 0)
  .sort((left, right) => lastReadTimestamp(right.lastReadAt) - lastReadTimestamp(left.lastReadAt));

