export const BOOKMARK_GROUP_COLORS = ['amber', 'coral', 'cyan', 'sage', 'violet', 'blue', 'rose', 'slate'] as const;
export const BOOKMARK_GROUP_ICONS = ['bookmark', 'star', 'idea', 'question', 'project', 'archive'] as const;

export type BookmarkGroupColor = typeof BOOKMARK_GROUP_COLORS[number];
export type BookmarkGroupIcon = typeof BOOKMARK_GROUP_ICONS[number];

export const bookmarkGroupName = (value: unknown): string =>
  String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80);

export const bookmarkGroupColor = (value: unknown): BookmarkGroupColor =>
  BOOKMARK_GROUP_COLORS.includes(value as BookmarkGroupColor) ? value as BookmarkGroupColor : 'amber';

export const bookmarkGroupIcon = (value: unknown): BookmarkGroupIcon =>
  BOOKMARK_GROUP_ICONS.includes(value as BookmarkGroupIcon) ? value as BookmarkGroupIcon : 'bookmark';
