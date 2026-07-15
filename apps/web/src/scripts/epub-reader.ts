import 'foliate-js/view.js';
import type { ReaderCommandDetail, ReaderControlsState, ReaderPlayFromDetail } from '../lib/reader-controls';

type SaveState = (message: string, tone?: 'ready' | 'saving' | 'error') => void;
type ReadingPreferences = { flow: 'paginated' | 'scrolled'; fontScale: number };
type TocItem = { label?: string; href?: string; subitems?: TocItem[] };
type RelocateDetail = { cfi?: string; fraction?: number; index?: number; tocItem?: { label?: string } };
type EpubSection = { linear?: string; createDocument?: () => Promise<Document> };
type ReaderSourceDetail = { kind?: string; load?: () => Promise<string> };
type ReaderLocationDetail = { text?: string; start?: number };
type ReaderSectionShiftDetail = { delta: number; currentOffset?: number; targetOffset?: number };
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
  let currentSectionIndex = 0;
  let currentChapter = 'cap';
  const contentIndexes = new WeakMap<Document, number>();
  const pointerStarts = new WeakMap<Document, { x: number; y: number }>();

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
  const externalControls = Boolean(element.closest('[data-dashboard-reader]'));
  controls.hidden = externalControls; stage.classList.toggle('external-controls', externalControls);

  const emitControls = () => pod?.dispatchEvent(new CustomEvent<ReaderControlsState>('seshat:reader-controls', { detail: {
    format: 'epub', chapter: currentChapter, pageLabel: progress.textContent || 'Reading', flow: preferences.flow, fontScale: preferences.fontScale,
  } }));

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
  const clearPlayTooltip = () => contentDocuments.forEach((doc) => doc.querySelectorAll('.seshat-play-from-tooltip').forEach((node) => node.remove()));
  const markReading = (doc: Document, text: string) => {
    clearReadingMarker(); const target = readingBlock(doc, text); if (!target) return;
    target.setAttribute('data-seshat-read-aloud', ''); target.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  };
  const provideReaderSource = (event: Event) => { const detail = (event as CustomEvent<ReaderSourceDetail>).detail; if (!detail || detail.load) return; detail.kind = 'epub'; detail.load = loadReaderText; };
  const locateReaderText = (event: Event) => {
    const detail = (event as CustomEvent<ReaderLocationDetail>).detail || {}; const start = Number(detail.start); const text = String(detail.text || '');
    const section = sectionRanges.find((item) => start >= item.start && start <= item.end); if (!section || !text) return;
    pendingLocation = { index: section.index, text };
    const visible = view.renderer?.getContents?.().find((item) => item.index === section.index);
    if (visible) markReading(visible.doc, text);
    else void view.goTo(section.index).then(() => window.requestAnimationFrame(() => { const content = view.renderer?.getContents?.().find((item) => item.index === section.index); if (content) markReading(content.doc, text); }));
  };
  const clearReaderText = () => { pendingLocation = null; clearReadingMarker(); };
  const sentenceAtPoint = (doc: Document, event: PointerEvent): string => {
    const target = event.target as HTMLElement | null; const block = target?.closest<HTMLElement>(blockSelector) || target; if (!block) return '';
    const text = String(block.textContent || '').replace(/\s+/g, ' ').trim(); if (!text) return '';
    const caret = (doc as any).caretPositionFromPoint?.(event.clientX, event.clientY); const rangeAtPoint = caret ? null : (doc as any).caretRangeFromPoint?.(event.clientX, event.clientY);
    const node = caret?.offsetNode || rangeAtPoint?.startContainer; const offset = caret?.offset ?? rangeAtPoint?.startOffset; let localOffset = 0;
    if (node && block.contains(node) && Number.isFinite(offset)) try { const range = doc.createRange(); range.selectNodeContents(block); range.setEnd(node, offset); localOffset = range.toString().replace(/\s+/g, ' ').length; } catch {}
    try { const segments = [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text)]; return String(segments.find((item) => localOffset >= item.index && localOffset <= item.index + item.segment.length)?.segment || text).trim(); }
    catch { return text; }
  };
  const offerPlayFrom = async (event: PointerEvent, doc: Document) => {
    const start = pointerStarts.get(doc); if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    const target = event.target as HTMLElement | null; if (!target || target.closest('a,button,input,select,textarea,[contenteditable="true"],.seshat-play-from-tooltip')) return;
    if (doc.defaultView?.getSelection()?.toString().trim()) return;
    await loadReaderText(); const index = contentIndexes.get(doc); const section = sectionRanges.find((item) => item.index === index); const quote = sentenceAtPoint(doc, event); if (!section || !quote || !doc.body) return;
    clearPlayTooltip(); const tooltip = doc.createElement('button'); tooltip.type = 'button'; tooltip.className = 'seshat-play-from-tooltip'; tooltip.textContent = 'Play from here';
    const width = doc.defaultView?.innerWidth || 320, height = doc.defaultView?.innerHeight || 480; tooltip.style.left = `${Math.max(8, Math.min(width - 126, event.clientX + 8))}px`; tooltip.style.top = `${Math.max(8, Math.min(height - 40, event.clientY + 8))}px`;
    tooltip.addEventListener('click', (click) => { click.preventDefault(); click.stopPropagation(); tooltip.remove(); pod?.dispatchEvent(new CustomEvent<ReaderPlayFromDetail>('seshat:reader-play-from', { detail: { quote, sectionStart: section.start, sectionEnd: section.end } })); });
    doc.body.appendChild(tooltip); window.setTimeout(() => tooltip.remove(), 5000);
  };
  const contentPointerDown = (event: Event) => { const pointer = event as PointerEvent; pointerStarts.set(pointer.currentTarget as Document, { x: pointer.clientX, y: pointer.clientY }); };
  const contentPointerUp = (event: Event) => { const pointer = event as PointerEvent; void offerPlayFrom(pointer, pointer.currentTarget as Document); };
  const shiftReaderSection = (event: Event) => {
    const detail = (event as CustomEvent<ReaderSectionShiftDetail>).detail; if (!detail || !sectionRanges.length) return;
    const current = sectionRanges.findIndex((item) => Number.isFinite(detail.currentOffset) && Number(detail.currentOffset) >= item.start && Number(detail.currentOffset) <= item.end);
    const fallback = Math.max(0, sectionRanges.findIndex((item) => item.index === currentSectionIndex)); const target = sectionRanges[Math.max(0, Math.min(sectionRanges.length - 1, (current >= 0 ? current : fallback) + Math.sign(detail.delta)))];
    if (target) detail.targetOffset = target.start;
  };
  const readerCommand = (event: Event) => {
    const command = (event as CustomEvent<ReaderCommandDetail>).detail?.command;
    if (command === 'toggle-toc') tocButton.click(); else if (command === 'previous-page') previous.click(); else if (command === 'next-page') next.click();
    else if (command === 'font-smaller') smaller.click(); else if (command === 'font-reset') { preferences.fontScale = 1; applyFont(); save(); emitControls(); }
    else if (command === 'font-larger') larger.click(); else if (command === 'toggle-flow') { preferences.flow = preferences.flow === 'paginated' ? 'scrolled' : 'paginated'; applyFlow(); save(); emitControls(); }
  };
  pod?.addEventListener('seshat:reader-source', provideReaderSource);
  pod?.addEventListener('seshat:epub-reader-locate', locateReaderText);
  pod?.addEventListener('seshat:epub-reader-clear', clearReaderText);
  pod?.addEventListener('seshat:reader-section-shift', shiftReaderSection);
  pod?.addEventListener('seshat:reader-command', readerCommand);

  const applyFont = () => {
    scale.textContent = `${Math.round(preferences.fontScale * 100)}%`;
    for (const content of view.renderer?.getContents?.() || []) {
      content.doc.documentElement.style.fontSize = `${preferences.fontScale * 100}%`;
    }
  };
  const applyAppearance = (doc: Document) => {
    let style = doc.getElementById('seshat-epub-theme') as HTMLStyleElement | null;
    if (!style) { style = doc.createElement('style'); style.id = 'seshat-epub-theme'; (doc.head || doc.documentElement).appendChild(style); }
    style.textContent = `${inverted ? `:root{color-scheme:dark!important;background:#111513!important}html,body{background:#111513!important;color:#e4e1d8!important}a{color:#8bb99c!important}img,svg,video{filter:none!important}` : ''}[data-seshat-read-aloud]{box-shadow:inset 2px 0 #b07a3c!important;padding-inline-start:.45em!important}.seshat-play-from-tooltip{position:fixed;z-index:2147483647;min-height:30px;padding:0 10px;border:1px solid #b07a3c;border-radius:5px;color:#17231d;background:#f1efe6;font:10px ui-monospace,monospace;box-shadow:0 7px 22px rgba(0,0,0,.24);cursor:pointer}`;
    doc.documentElement.style.backgroundColor = inverted ? '#111513' : '';
    if (doc.body) { doc.body.style.backgroundColor = inverted ? '#111513' : ''; doc.body.style.color = inverted ? '#e4e1d8' : ''; }
  };
  const applyFlow = () => {
    flow.value = preferences.flow;
    view.renderer?.setAttribute('flow', preferences.flow);
    emitControls();
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
  smaller.addEventListener('click', () => { preferences.fontScale = clampScale(preferences.fontScale - .1); applyFont(); save(); emitControls(); });
  larger.addEventListener('click', () => { preferences.fontScale = clampScale(preferences.fontScale + .1); applyFont(); save(); emitControls(); });
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
    if (doc) { applyAppearance(doc); if (Number.isFinite(index)) contentIndexes.set(doc, index); if (!contentDocuments.has(doc)) { contentDocuments.add(doc); doc.addEventListener('keydown', readerKeyboard); doc.addEventListener('pointerdown', contentPointerDown); doc.addEventListener('pointerup', contentPointerUp); } if (pendingLocation && (!Number.isFinite(index) || index === pendingLocation.index)) markReading(doc, pendingLocation.text); }
  };
  view.addEventListener('load', handleLoad);
  view.addEventListener('relocate', ((event: CustomEvent<RelocateDetail>) => {
    const detail = event.detail || {};
    if (Number.isFinite(detail.index)) currentSectionIndex = Number(detail.index);
    lastLocation = detail.cfi || lastLocation;
    const percentage = Number.isFinite(detail.fraction) ? `${Math.round((detail.fraction || 0) * 100)}%` : '';
    currentChapter = detail.tocItem?.label || currentChapter; progress.textContent = [currentChapter === 'cap' ? '' : currentChapter, percentage].filter(Boolean).join(' · ') || 'Reading'; emitControls();
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
    pod?.removeEventListener('seshat:reader-section-shift', shiftReaderSection);
    pod?.removeEventListener('seshat:reader-command', readerCommand);
    view.removeEventListener('load', handleLoad); view.removeEventListener('keydown', readerKeyboard);
    contentDocuments.forEach((doc) => { doc.removeEventListener('keydown', readerKeyboard); doc.removeEventListener('pointerdown', contentPointerDown); doc.removeEventListener('pointerup', contentPointerUp); }); contentDocuments.clear();
    view.close();
  };
}
