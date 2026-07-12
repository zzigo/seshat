import 'foliate-js/view.js';

type SaveState = (message: string, tone?: 'ready' | 'saving' | 'error') => void;
type ReadingPreferences = { flow: 'paginated' | 'scrolled'; fontScale: number };
type TocItem = { label?: string; href?: string; subitems?: TocItem[] };
type RelocateDetail = { cfi?: string; fraction?: number; tocItem?: { label?: string } };
type FoliateView = HTMLElement & {
  open(input: File | string): Promise<void>;
  init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
  close(): void;
  prev(): Promise<void>;
  next(): Promise<void>;
  goTo(target: string | number | { fraction: number }): Promise<void>;
  book?: { toc?: TocItem[] };
  renderer?: HTMLElement & { getContents?: () => Array<{ doc: Document }> };
};

const clampScale = (value: unknown): number => Math.max(.7, Math.min(2, Number(value) || 1));

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

  const applyFont = () => {
    scale.textContent = `${Math.round(preferences.fontScale * 100)}%`;
    for (const content of view.renderer?.getContents?.() || []) {
      content.doc.documentElement.style.fontSize = `${preferences.fontScale * 100}%`;
    }
  };
  const applyAppearance = (doc: Document) => {
    let style = doc.getElementById('seshat-epub-theme') as HTMLStyleElement | null;
    if (!style) { style = doc.createElement('style'); style.id = 'seshat-epub-theme'; (doc.head || doc.documentElement).appendChild(style); }
    style.textContent = inverted ? `:root{color-scheme:dark!important;background:#111513!important}html,body{background:#111513!important;color:#e4e1d8!important}a{color:#8bb99c!important}img,svg,video{filter:none!important}` : '';
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
    if (doc) { applyAppearance(doc); if (!contentDocuments.has(doc)) { contentDocuments.add(doc); doc.addEventListener('keydown', readerKeyboard); } }
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
  const pod = element.parentElement;
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
    if (disposed) return () => undefined;
    renderToc(view.book?.toc || [], sidebar);
    applyFlow(); applyFont();
    await view.init({ lastLocation: lastLocation || undefined, showTextStart: !lastLocation });
    view.focus();
    setSaveState('EPUB ready');
    window.setTimeout(() => setSaveState('ready'), 1200);
  } catch (error) {
    if (!disposed && (error as Error).name !== 'AbortError') {
      readingSurface.textContent = error instanceof Error ? error.message : 'EPUB reader unavailable.';
      setSaveState('EPUB reader unavailable', 'error');
    }
  }

  return () => {
    disposed = true; controller.abort(); window.clearTimeout(saveTimer);
    pod?.removeEventListener('seshat:doc-toggle-invert', invert);
    pod?.removeEventListener('seshat:pdf-zoom-reset', reset);
    view.removeEventListener('load', handleLoad); view.removeEventListener('keydown', readerKeyboard);
    contentDocuments.forEach((doc) => doc.removeEventListener('keydown', readerKeyboard)); contentDocuments.clear();
    view.close();
  };
}
