import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { annotationColors, mountAnnotationWorkspace, type Annotation } from './annotations';

GlobalWorkerOptions.workerSrc = workerSrc;
const SIDEBAR_WIDTH_KEY = 'seshat.pdf.annotation-sidebar-width';

type PdfAnchor = {
  quote: string; prefix: string; suffix: string; startOffset: number; endOffset: number;
  sourceKind: 'pdf'; page: number; locator: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
};

export async function mountPdfViewer(
  element: HTMLElement,
  referenceId: string,
  title: string,
  report: (message: string, tone?: 'ready' | 'saving' | 'error') => void,
): Promise<() => void> {
  const shell = document.createElement('div'); shell.className = 'seshat-pdf-shell';
  const viewer = document.createElement('div'); viewer.className = 'seshat-pdf-viewer';
  const pages = document.createElement('div'); pages.className = 'seshat-pdf-pages'; viewer.appendChild(pages);
  const sidebar = document.createElement('aside'); sidebar.className = 'seshat-pdf-annotations';
  const savedSidebarWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (Number.isFinite(savedSidebarWidth) && savedSidebarWidth >= 240) shell.style.setProperty('--annotation-sidebar-width', `${savedSidebarWidth}px`);
  const resizeHandle = document.createElement('div'); resizeHandle.className = 'pdf-annotation-resizer'; resizeHandle.tabIndex = 0;
  resizeHandle.setAttribute('role', 'separator'); resizeHandle.setAttribute('aria-orientation', 'vertical'); resizeHandle.setAttribute('aria-label', 'Resize annotation sidebar');
  const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'pdf-annotation-toggle';
  toggle.textContent = '☰'; toggle.title = 'Annotations'; toggle.setAttribute('aria-label', 'Toggle annotations'); toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const open = !shell.classList.contains('annotations-open'); shell.classList.toggle('annotations-open', open); toggle.setAttribute('aria-expanded', String(open));
  });
  const setSidebarWidth = (width: number) => {
    const maximum = Math.max(280, Math.min(620, shell.getBoundingClientRect().width * .68));
    const next = Math.round(Math.max(240, Math.min(maximum, width)));
    shell.style.setProperty('--annotation-sidebar-width', `${next}px`); window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
  };
  resizeHandle.addEventListener('pointerdown', (event) => {
    event.preventDefault(); resizeHandle.setPointerCapture(event.pointerId); shell.classList.add('resizing-annotations');
    const move = (moveEvent: PointerEvent) => setSidebarWidth(shell.getBoundingClientRect().right - moveEvent.clientX);
    const stop = () => { shell.classList.remove('resizing-annotations'); resizeHandle.removeEventListener('pointermove', move); resizeHandle.removeEventListener('pointerup', stop); resizeHandle.removeEventListener('pointercancel', stop); };
    resizeHandle.addEventListener('pointermove', move); resizeHandle.addEventListener('pointerup', stop); resizeHandle.addEventListener('pointercancel', stop);
  });
  resizeHandle.addEventListener('dblclick', () => setSidebarWidth(340));
  resizeHandle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault();
    const current = sidebar.getBoundingClientRect().width || 340; setSidebarWidth(current + (event.key === 'ArrowLeft' ? 20 : -20));
  });
  const progress = document.createElement('div'); progress.className = 'pdf-loading'; progress.textContent = 'Loading PDF…';
  pages.appendChild(progress); shell.append(viewer, sidebar, toggle); element.replaceChildren(shell);

  let annotations: Annotation[] = [];
  let pending: PdfAnchor | null = null;
  let disposed = false;
  const dialogs = new Set<HTMLDialogElement>();
  const renderTasks = new Set<{ cancel: () => void }>();
  const loadingTask = getDocument({ url: `/api/library/${referenceId}/original`, withCredentials: true });
  const pdf = await loadingTask.promise;
  if (disposed) { await pdf.destroy(); return () => undefined; }
  const annotationResponse = await fetch(`/api/library/${referenceId}/annotations`);
  if (annotationResponse.ok) annotations = (await annotationResponse.json()).annotations || [];
  const disposeIndex = await mountAnnotationWorkspace(sidebar, referenceId, title, report, { indexOnly: true });
  sidebar.prepend(resizeHandle);
  progress.remove();

  const palette = document.createElement('div'); palette.className = 'annotation-palette pdf-annotation-palette'; palette.hidden = true;
  annotationColors.forEach((color, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.style.setProperty('--annotation-color', color.hex);
    button.title = `${index + 1} · ${color.label}`; button.setAttribute('aria-label', button.title);
    const dot = document.createElement('i'); const key = document.createElement('small'); key.textContent = String(index + 1); button.append(dot, key);
    button.addEventListener('click', () => { if (pending) void save(pending, color); }); palette.appendChild(button);
  });
  const comment = document.createElement('button'); comment.type = 'button'; comment.className = 'annotation-comment'; comment.textContent = 'M'; comment.title = 'Comment selection';
  comment.addEventListener('click', () => { if (pending) openComposer(pending); }); palette.appendChild(comment); document.body.appendChild(palette);

  const renderHighlights = (pageElement: HTMLElement) => {
    const layer = pageElement.querySelector<HTMLElement>('.pdf-highlight-layer'); if (!layer) return;
    layer.replaceChildren(); const page = Number(pageElement.dataset.page);
    annotations.filter((item) => item.sourceKind === 'pdf' && item.page === page).forEach((annotation) => {
      annotation.rects.forEach((rect) => {
        const highlight = document.createElement('button'); highlight.type = 'button'; highlight.className = 'pdf-annotation-highlight';
        highlight.style.cssText = `--annotation-color:${annotation.color};left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%`;
        highlight.title = annotation.note || annotation.quote; highlight.setAttribute('aria-label', `Annotation: ${annotation.quote.slice(0, 80)}`);
        highlight.addEventListener('click', () => { shell.classList.add('annotations-open'); toggle.setAttribute('aria-expanded', 'true'); }); layer.appendChild(highlight);
      });
    });
  };

  const observer = new IntersectionObserver((entries) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      const pageElement = entry.target as HTMLElement; observer.unobserve(pageElement); void renderPage(pageElement);
    });
  }, { root: viewer, rootMargin: '800px 0px' });

  const renderPage = async (pageElement: HTMLElement) => {
    const pageNumber = Number(pageElement.dataset.page); const page = await pdf.getPage(pageNumber); if (disposed) return;
    const viewport = page.getViewport({ scale: Number(pageElement.dataset.scale) });
    const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas')!; const context = canvas.getContext('2d')!; const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    const task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
    renderTasks.add(task); await task.promise.catch(() => undefined); renderTasks.delete(task); if (disposed) return;
    const textLayerElement = pageElement.querySelector<HTMLElement>('.textLayer')!;
    const textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: textLayerElement, viewport });
    await textLayer.render(); renderHighlights(pageElement); pageElement.classList.add('rendered');
  };

  const firstPage = await pdf.getPage(1); const base = firstPage.getViewport({ scale: 1 });
  const available = Math.max(480, viewer.clientWidth - 72); const scale = Math.max(.75, Math.min(1.65, available / base.width));
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale });
    const pageElement = document.createElement('section'); pageElement.className = 'seshat-pdf-page'; pageElement.dataset.page = String(pageNumber); pageElement.dataset.scale = String(scale);
    pageElement.style.width = `${viewport.width}px`; pageElement.style.height = `${viewport.height}px`; pageElement.style.setProperty('--total-scale-factor', String(scale));
    const canvas = document.createElement('canvas'); const highlights = document.createElement('div'); highlights.className = 'pdf-highlight-layer';
    const textLayer = document.createElement('div'); textLayer.className = 'textLayer';
    const number = document.createElement('span'); number.className = 'pdf-page-number'; number.textContent = String(pageNumber);
    pageElement.append(canvas, highlights, textLayer, number); pages.appendChild(pageElement); observer.observe(pageElement);
  }

  const anchorFromSelection = (): PdfAnchor | null => {
    const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0); const node = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer as Element : range.commonAncestorContainer.parentElement;
    const pageElement = node?.closest<HTMLElement>('.seshat-pdf-page'); if (!pageElement || !viewer.contains(pageElement)) return null;
    const startPage = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement)?.closest('.seshat-pdf-page');
    const endPage = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer as Element : range.endContainer.parentElement)?.closest('.seshat-pdf-page');
    if (startPage !== pageElement || endPage !== pageElement) { report('Select within one PDF page at a time', 'error'); return null; }
    const textLayer = pageElement.querySelector<HTMLElement>('.textLayer')!; const before = document.createRange(); before.selectNodeContents(textLayer); before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length; const quote = range.toString(); if (!quote.trim()) return null; const endOffset = startOffset + quote.length;
    const pageRect = pageElement.getBoundingClientRect(); const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0).map((rect) => ({
      x: Math.max(0, (rect.left - pageRect.left) / pageRect.width), y: Math.max(0, (rect.top - pageRect.top) / pageRect.height),
      width: Math.min(1, rect.width / pageRect.width), height: Math.min(1, rect.height / pageRect.height),
    }));
    const pageText = textLayer.textContent || '';
    return { quote, startOffset, endOffset, sourceKind: 'pdf', page: Number(pageElement.dataset.page), locator: `p. ${pageElement.dataset.page}`, rects,
      prefix: pageText.slice(Math.max(0, startOffset - 250), startOffset), suffix: pageText.slice(endOffset, endOffset + 250) };
  };

  const showPalette = () => {
    pending = anchorFromSelection(); if (!pending) { palette.hidden = true; return; }
    const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect(); palette.hidden = false; const bounds = palette.getBoundingClientRect();
    palette.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`; palette.style.top = `${Math.max(8, rect.top - bounds.height - 8)}px`;
  };

  async function save(anchor: PdfAnchor, color: typeof annotationColors[number], details: Record<string, unknown> = {}) {
    palette.hidden = true; report('saving PDF annotation…', 'saving');
    const response = await fetch(`/api/library/${referenceId}/annotations`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ ...anchor, color: color.hex, category: color.category, ...details }) });
    const result = await response.json().catch(() => ({})); if (!response.ok) { report(result.error || 'Annotation could not be saved', 'error'); return; }
    annotations.push(result.annotation); pending = null; window.getSelection()?.removeAllRanges(); pages.querySelectorAll<HTMLElement>('.seshat-pdf-page').forEach(renderHighlights);
    window.dispatchEvent(new CustomEvent('seshat:annotations-changed', { detail: { referenceId } })); report('PDF annotation saved');
  }

  function openComposer(anchor: PdfAnchor) {
    palette.hidden = true; const dialog = document.createElement('dialog'); dialog.className = 'annotation-editor pdf-annotation-editor'; dialogs.add(dialog);
    const form = document.createElement('form'); const head = document.createElement('header'); head.innerHTML = '<strong>Comment PDF selection</strong>';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.addEventListener('click', () => dialog.close()); head.appendChild(close);
    const quote = document.createElement('blockquote'); quote.textContent = anchor.quote; let selected = annotationColors[0];
    const colors = document.createElement('div'); colors.className = 'annotation-editor-colors';
    annotationColors.forEach((color) => { const button = document.createElement('button'); button.type = 'button'; button.style.setProperty('--annotation-color', color.hex); button.innerHTML = `<i></i><span>${color.sigil}</span>`;
      button.classList.toggle('selected', color === selected); button.addEventListener('click', () => { selected = color; colors.querySelectorAll('button').forEach((item) => item.classList.toggle('selected', item === button)); }); colors.appendChild(button); });
    const typeLabel = document.createElement('label'); typeLabel.textContent = 'Note type'; const type = document.createElement('select');
    [['','—'],['explanatory','Explanatory'],['critical','Critical'],['projective','Projective']].forEach(([value,label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; type.appendChild(option); }); typeLabel.appendChild(type);
    const noteLabel = document.createElement('label'); noteLabel.textContent = 'Comment'; const note = document.createElement('textarea'); note.rows = 5; noteLabel.appendChild(note);
    const targetLabel = document.createElement('label'); targetLabel.textContent = 'Targets (comma separated)'; const targets = document.createElement('input'); targetLabel.appendChild(targets);
    const footer = document.createElement('footer'); const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'primary'; submit.textContent = 'Save'; footer.appendChild(submit);
    form.append(head, quote, colors, typeLabel, targetLabel, noteLabel, footer); dialog.appendChild(form); document.body.appendChild(dialog);
    dialog.addEventListener('close', () => { dialogs.delete(dialog); dialog.remove(); }); form.addEventListener('submit', (event) => { event.preventDefault(); void save(anchor, selected, { noteType: type.value || undefined, note: note.value, targets: targets.value.split(',').map((item) => item.trim()).filter(Boolean) }); dialog.close(); });
    dialog.showModal(); note.focus();
  }

  const changed = async (event: Event) => {
    if ((event as CustomEvent).detail?.referenceId !== referenceId) return; const response = await fetch(`/api/library/${referenceId}/annotations`); if (!response.ok) return;
    annotations = (await response.json()).annotations || []; pages.querySelectorAll<HTMLElement>('.seshat-pdf-page.rendered').forEach(renderHighlights);
  };
  const keyboard = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.matches('input,textarea,select,[contenteditable="true"]')) return; const index = Number(event.key) - 1;
    if (pending && index >= 0 && index < annotationColors.length) { event.preventDefault(); void save(pending, annotationColors[index]); }
    else if (pending && event.key.toLowerCase() === 'm') { event.preventDefault(); openComposer(pending); }
  };
  viewer.addEventListener('mouseup', () => window.setTimeout(showPalette)); document.addEventListener('keydown', keyboard); window.addEventListener('seshat:annotations-changed', changed);

  return () => {
    disposed = true; observer.disconnect(); renderTasks.forEach((task) => task.cancel()); disposeIndex(); palette.remove(); dialogs.forEach((dialog) => dialog.remove());
    document.removeEventListener('keydown', keyboard); window.removeEventListener('seshat:annotations-changed', changed); void pdf.destroy();
  };
}
