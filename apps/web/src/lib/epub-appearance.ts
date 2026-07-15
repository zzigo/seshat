export type EpubDocumentAppearance = {
  background: string;
  foreground: string;
  link: string;
  colorScheme: 'light' | 'dark';
};

export const epubDocumentAppearance = (inverted: boolean): EpubDocumentAppearance => inverted
  ? { background: '#111513', foreground: '#e4e1d8', link: '#8bb99c', colorScheme: 'dark' }
  : { background: '#f5f1e8', foreground: '#262b27', link: '#244f3a', colorScheme: 'light' };

export const epubDocumentThemeCss = (inverted: boolean): string => {
  const appearance = epubDocumentAppearance(inverted);
  return `:root{color-scheme:${appearance.colorScheme}!important;background:${appearance.background}!important}html,body{background-color:${appearance.background}!important;color:${appearance.foreground}!important}a{color:${appearance.link}!important}img,svg,video{filter:none!important}`;
};
