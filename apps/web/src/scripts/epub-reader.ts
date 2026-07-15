import 'foliate-js/view.js';

type SaveState = (message: string, tone?: 'ready' | 'saving' | 'error') => void;
type ReadingPreferences = { flow: 'paginated' | 'scrolled'; fontScale: number };
type TocItem = { label?: string; href?: string; subitems?: TocItem[] };
type RelocateDetail = { cfi?: string; fraction?: number; index?: number; tocItem?: { label?: string } };
type EpubSection = { linear?: string; createDocument?: () => Promise<Document> };
type ReaderSourceDetail = { kind?: string; load?: () => Promise<string> };
type ReaderLocationDetail = { text?: string; start?: number };
type FoliateView = HTMLElement & {
  open(input: File | string): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  close(): void;
  prev(): Promise<void>;
  next(): Promise<void>;
  goTo(target: string | number | { fraction: number }): Promise<void>;
  book?: { toc?: TocItem[]; sections?: EpubSection[] };
  renderer?: HTMLElement & { getContents?: () => Array<{ doc: Document; index?: number }> };
};

const clampScale = (value: unknown): number => Math.max(.7, Math.min(2, Number(value) || 1));
const blockSelector = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,dt,dd,td,th,pre';
const normalizeMatch = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const documentText = (doc: Document): string => {
  const root = (doc.body || doc.documentElement)?.cloneNode(true) as HTMLElement | undefined;
  if (!root) return '';
  root.querySelectorAll('script,style,noscript,template,svg,nav,[hidden],[aria-hidden="true"]').forEach((node) => node.remove());
  root.querySelectorAll('br').forEach((node) => node.replaceWith(root.ownerDocument.createTextNode('\n')));
  root.querySelectorAll(blockSelector).forEach((node) => node.append(root.ownerDocument.createTextNode('\n\n')));
  return String(root.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
};
const readingBlock = (doc: Document, text: string): HTMLElement | null => {
  const needle = normalizeMatch(text); if (!needle) return null;
  const words = needle.split(' ').filter((word) => word.length > 3).slice(0, 10);
  let best: { element: HTMLElement; score: number } | null = null;
  for (const element of doc.querySelectorAll<HTMLElement>(blockSelector)) {
    const candidate = normalizeMatch(element.textContent || ''); if (!candidate) continue;
    const score = (candidate.includes(needle) || needle.includes(candidate) ? 100 : 0) + words.filter((word) => candidate.includes(word)).length;
    if (!best || score > best.score) best = { element, score };
  }
  return best && best.score >= Math.min(3, words.length) ? best.element : null;
};

export async function mountEpubReader(
  element: HTMLElement,
  referenceId: string,
  title: string,
  setSaveState: SaveState,
): Promise<() => void> {
  const controller = new AbortController();
  let disposed = false;
  let saveTimer = 0;
  let lastLocation = '';
  let preferences: ReadingPreferences = { flow: 'paginated', fontScale: 1 };
  let inverted = false;
  const contentDocuments = new Set<Document>();
  let signalBookReady: () => void = () => {};
  const bookReady = new Promise<void>((resolve) => { signalBookReady = resolve; });
  let textPromise: Promise<string> | null = null;
  let sectionRanges: Array<{ index: number; start: number; end: number }> = [];
  let pendingLocation: { index: number; text: string } | null = null;

  element.classList.add('pod-epub-body');
  const shell = document.createElement('div'); shell.className = 'seshat-epub-shell';
  const sidebar = document.createElement('aside'); sidebar.className = 'epub-toc'; sidebar.hidden = true;
  const tocHeading = document.createElement('strong'); tocHeading.textContent = 'Contents'; sidebar.appendChild(tocHeading);
  const stage = document.createElement('section'); stage.className = 'epub-stage';
  const controls = document.createElement('header'); controls.className = 'epub-controls';
  const tocButton = document.createElement('button'); tocButton.type = 'button'; tocButton.textContent = '☰'; tocButton.title = 'Table of contents';
  const previous = document.createElement('button'); previous.type = 'button'; previous.textContent = '←'; previous.title = 'Previous page';
  const next = document.createElement('button'); next.type = 'button'; next.textContent = '→'; next.title = 'Next page';
  const progress = document.createElement('span'); progress.className = 'epub-progress'; progress.textContent = 'Opening EPUB…';
  const flow = document.createElement('select'); flow.title = 'Reading flow'; flow.setAttribute('aria-label', 'Reading flow');
  flow.append(new Option('Pages', 'paginated'), new Option('Scroll', 'scrolled'));
  const smaller = document.createElement('button'); smaller.type = 'button'; smaller.textContent = 'A−'; smaller.title = 'Smaller text';
  const scale = document.createElement('span'); scale.className = 'epub-scale';
  const larger = document.createElement('button'); larger.type = 'button'; larger.textContent = 'A+'; larger.title = 'Larger text';
  controls.append(tocButton, previous, next, progress, flow, smaller, scale, larger);
  const readingSurface = document.createElement('div'); readingSurface.className = 'epub-reading-surface';
  const view = document.createElement('foliate-view') as FoliateView; view.tabIndex = 0; readingSurface.appendChild(view);
  stage.append(controls, readingSurface); shell.append(sidebar, stage); element.appendChild(shell);
  const pod = element.parentElement;

  const loadReaderText = async () => {
    await bookReady;
    if (textPromise) return textPromise;
    textPromise = (async () => {
      const sections = view.book?.sections || []; const parts: string[] = []; sectionRanges = []; let offset = 0;
      for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index]; if (!section.createDocument || section.linear === 'no') continue;
        const text = documentText(await section.createDocument()); if (!text) continue;
        if (parts.length) offset += 2;
        const start = offset; parts.push(text); offset += text.length; sectionRanges.push({ index, start, end: offset });
      }
      const text = parts.join('\n\n'); if (!text) throw new Error('This EPUB contains no readable text.'); return text;
    })();
    return textPromise;
  };
  const clearReadingMarker = () => contentDocuments.forEach((doc) => doc.querySelectorAll('[data-seshat-read-aloud]').forEach((node) => node.removeAttribute('data-seshat-read-aloud')));
  const markReading = (doc: Document, text: string) => {
    clearReadingMarker(); const target = readingBlock(doc, text); if (!target) return;
    target.setAttribute('data-seshat-read-aloud', ''); target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };
  const provideReaderSource = (event: Event) => { const detail = (event as CustomEvent<ReaderSourceDetail>).detail; if (!detail?.load) { detail.kind = 'epub'; detail.load = loadReaderText; } };
  const locateReaderText = (event: Event) => {
    const detail = (event as CustomEvent<ReaderLocationDetail>).detail || {}; const start = Number(detail.start); const text = String(detail.text || '');
    const section = sectionRanges.find((item) => start >= item.start && start <= item.end); if (!section || !text) return;
    pendingLocation = { index: section.index, text };
    const visible = view.renderer?.getContents?.().find((item) => item.index === section.index);
    if (visible) markReading(visible.doc, text);
    else void view.goTo(section.index).then(() => window.requestAnimationFrame(() => { const content = view.renderer?.getContents?.().find((item) => item.index === section.index); if (content) markReading(content.doc, text); }));
  };
  const clearReaderText = () => { pendingLocation = null; clearReadingMarker(); };
  pod?.addEventListener('seshat:reader-source', provideReaderSource);
  pod?.addEventListener('seshat:epub-reader-locate', locateReaderText);
  pod?.addEventListener('seshat:epub-reader-clear', clearReaderText);

  const applyFont = () => {
    scale.textContent = `${Math.round(preferences.fontScale * 100)}%`;
    for (const content of view.renderer?.getContents?.() || []) {
      content.doc.documentElement.style.fontSize = `${preferences.fontScale * 100}%`;
    }
  };
  const applyAppearance = (doc: Document) => {
    let style = doc.getElementById('seshat-epub-theme') as HTMLStyleElement | null;
    if (!style) { style = doc.createElement('style'); style.id = 'seshat-epub-theme'; (doc.head || doc.documentElement).appendChild(style); }
    style.textContent = `${inverted ? `:root{color-scheme:dark!important;background:#111513!important}html,body{background:#111513!important;color:#e4e1d8!important}a{color:#8bb99c!important}img,svg,video{filter:none!important}` : ''}[data-seshat-read-aloud]{box-shadow:inset 2px 0 #b07a3c!important;padding-inline-start:.45em!important}`;
    doc.documentElement.style.backgroundColor = inverted ? '#111513' : '';
    if (doc.body) { doc.body.style.backgroundColor = inverted ? '#111513' : ''; doc.body.style.color = inverted ? '#e4e1d8' : ''; }
  };
  const applyFlow = () => {
    flow.value = preferences.flow;
    view.renderer?.setAttribute('flow', preferences.flow);
  };
  const save = () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      void fetch(`/api/library/${referenceId}/reading-state`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ location: { cfi: lastLocation }, preferences }),
        signal: controller.signal,
      }).catch(() => undefined);
    }, 650);
  };
  const renderToc = (items: TocItem[], container: HTMLElement) => {
    for (const item of items) {
      const row = document.createElement('div'); row.className = 'epub-toc-item';
      const button = document.createElement('button'); button.type = 'button'; button.textContent = item.label || 'Untitled section';
      button.disabled = !item.href;
      button.addEventListener('click', () => {
        if (item.href) void view.goTo(item.href);
        if (window.innerWidth < 720) sidebar.hidden = true;
      });
      row.appendChild(button);
      if (item.subitems?.length) { const nested = document.createElement('div'); nested.className = 'epub-toc-nested'; renderToc(item.subitems, nested); row.appendChild(nested); }
      container.appendChild(row);
    }
  };

  tocButton.addEventListener('click', () => { sidebar.hidden = !sidebar.hidden; shell.classList.toggle('toc-open', !sidebar.hidden); });
  previous.addEventListener('click', () => void view.prev());
  next.addEventListener('click', () => void view.next());
  flow.addEventListener('change', () => { preferences.flow = flow.value === 'scrolled' ? 'scrolled' : 'paginated'; applyFlow(); save(); });
  smaller.addEventListener('click', () => { preferences.fontScale = clampScale(preferences.fontScale - .1); applyFont(); save(); });
  larger.addEventListener('click', () => { preferences.fontScale = clampScale(preferences.fontScale + .1); applyFont(); save(); });
  const readerKeyboard = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement | null)?.matches?.('input,textarea,select,[contenteditable="true"]')) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); void view.prev(); }
    if (event.key === 'ArrowRight') { event.preventDefault(); void view.next(); }
    if (event.key === '0') { event.preventDefault(); void view.goTo(0); }
    if (event.key === 'G') { event.preventDefault(); void view.goTo({ fraction: 1 }); }
  };
  const handleLoad = (event: Event) => {
    applyFont();
    const doc = (event as CustomEvent<{ doc?: Document }>).detail?.doc;
    const index = Number((event as CustomEvent<{ index?: number }>).detail?.index);
    if (doc) { applyAppearance(doc); if (!contentDocuments.has(doc)) { contentDocuments.add(doc); doc.addEventListener('keydown', readerKeyboard); } if (pendingLocation && (!Number.isFinite(index) || index === pendingLocation.index)) markReading(doc, pendingLocation.text); }
  };
  view.addEventListener('load', handleLoad);
  view.addEventListener('relocate', ((event: CustomEvent<RelocateDetail>) => {
    const detail = event.detail || {};
    lastLocation = detail.cfi || lastLocation;
    const percentage = Number.isFinite(detail.fraction) ? `${Math.round((detail.fraction || 0) * 100)}%` : '';
    progress.textContent = [detail.tocItem?.label, percentage].filter(Boolean).join(' · ') || 'Reading';
    save();
  }) as EventListener);
  view.addEventListener('keydown', readerKeyboard);
  const invert = (event: Event) => { inverted = Boolean((event as CustomEvent<{ active?: boolean }>).detail?.active); shell.classList.toggle('is-inverted',inverted); contentDocuments.forEach(applyAppearance); };
  const reset = () => { preferences.fontScale = 1; applyFont(); save(); };
  pod?.addEventListener('seshat:doc-toggle-invert', invert);
  pod?.addEventListener('seshat:pdf-zoom-reset', reset);

  try {
    setSaveState('opening EPUB…', 'saving');
    const [stateResponse, originalResponse] = await Promise.all([
      fetch(`/api/library/${referenceId}/reading-state`, { signal: controller.signal }),
      fetch(`/api/library/${referenceId}/original`, { signal: controller.signal }),
    ]);
    if (!originalResponse.ok) throw new Error('The EPUB original is not available.');
    const state = stateResponse.ok ? await stateResponse.json() as { location?: { cfi?: string }; preferences?: Partial<ReadingPreferences> } : {};
    lastLocation = String(state.location?.cfi || '');
    preferences = {
      flow: state.preferences?.flow === 'scrolled' ? 'scrolled' : 'paginated',
      fontScale: clampScale(state.preferences?.fontScale),
    };
    const blob = await originalResponse.blob();
    await view.open(new File([blob], `${title.replace(/[\\/:*?"<>|]/g, ' ')}.epub`, { type: 'application/epub+zip' }));
    signalBookReady();
    if (disposed) return () => undefined;
    renderToc(view.book?.toc || [], sidebar);
    applyFlow(); applyFont();
    await view.init({ lastLocation: lastLocation || undefined, showTextStart: !lastLocation });
    view.focus();
    setSaveState('EPUB ready');
    window.setTimeout(() => setSaveState('ready'), 1200);
  } catch (error) {
    signalBookReady();
    if (!disposed && (error as Error).name !== 'AbortError') {
      readingSurface.textContent = error instanceof Error ? error.message : 'EPUB reader unavailable.';
      setSaveState('EPUB reader unavailable', 'error');
    }
  }

  return () => {
    disposed = true; controller.abort(); window.clearTimeout(saveTimer);
    pod?.removeEventListener('seshat:doc-toggle-invert', invert);
    pod?.removeEventListener('seshat:pdf-zoom-reset', reset);
    pod?.removeEventListener('seshat:reader-source', provideReaderSource);
    pod?.removeEventListener('seshat:epub-reader-locate', locateReaderText);
    pod?.removeEventListener('seshat:epub-reader-clear', clearReaderText);
    view.removeEventListener('load', handleLoad); view.removeEventListener('keydown', readerKeyboard);
    contentDocuments.forEach((doc) => doc.removeEventListener('keydown', readerKeyboard)); contentDocuments.clear();
    view.close();
  };
}
