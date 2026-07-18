export type ReaderCommandName =
  | 'toggle-toc'
  | 'previous-page'
  | 'next-page'
  | 'previous-section'
  | 'next-section'
  | 'font-smaller'
  | 'font-reset'
  | 'font-larger'
  | 'toggle-flow'
  | 'zoom-reset'
  | 'toggle-book'
  | 'toggle-grid'
  | 'read'
  | 'read-settings'
  | 'play-rendered'
  | 'open-original';

export type ReaderCommandDetail = { command: ReaderCommandName };

export type ReaderControlsState = {
  format: 'pdf' | 'epub' | 'text';
  chapter?: string;
  pageLabel?: string;
  progress?: number;
  flow?: 'paginated' | 'scrolled';
  fontScale?: number;
  readLabel?: string;
  readState?: string;
  hasRendered?: boolean;
};

export type ReaderPlayFromDetail = {
  quote: string;
  sectionStart?: number;
  sectionEnd?: number;
};

export const READER_COMMAND_MESSAGE = 'seshat:reader-command';
export const READER_STATE_MESSAGE = 'seshat:reader-state';
export const READER_VOICE_LONG_PRESS_MS = 2000;
