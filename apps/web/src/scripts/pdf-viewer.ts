import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { annotationColors, mountAnnotationWorkspace, type Annotation } from './annotations';
import { currentPhoneResourceProfile } from '../lib/client-resources';
import { adjacentPdfPage, pdfPageScrollTop, pdfSpreadStart } from '../lib/pdf-navigation';
import { updateReadingLocation, type ReadingLocation } from '../lib/reading-progress';

GlobalWorkerOptions.workerSrc = workerSrc;
const SIDEBAR_WIDTH_KEY = 'seshat.pdf.annotation-sidebar-width';
const pendingPdfPages = new Map<string, number>();

export const navigatePdfToPage = (referenceId: string, page: number): void => {
  const target = Math.max(1, Math.floor(page));
  pendingPdfPages.set(referenceId, target);
  window.dispatchEvent(new CustomEvent('seshat:pdf-goto-reference-page', { detail: { referenceId, page: target } }));
};

type PdfAnchor = {
  quote: string; prefix: string; suffix: string; startOffset: number; endOffset: number;
  sourceKind: 'pdf'; page: number; locator: string;
  rects: Array<{ x: number; y: number; width: number; height: number }>;
};
type DjvuTextLayer = { pages?: Array<{ width:number; height:number; words?:Array<{x0:number;y0:number;x1:number;y1:number;text:string}> }> };

export async function mountPdfViewer(
  element: HTMLElement,
  referenceId: string,
  title: string,
  report: (message: string, tone?: 'ready' | 'saving' | 'error') => void,
  sourceUrl = `/api/library/${encodeURIComponent(referenceId)}/original`,
  textOverlayUrl?: string,
): Promise<() => void> {
  const shell = document.createElement('div'); shell.className = 'seshat-pdf-shell';
  const viewer = document.createElement('div'); viewer.className = 'seshat-pdf-viewer';
  viewer.tabIndex = 0;
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
    if (open) window.dispatchEvent(new CustomEvent('seshat:close-reader-sidebars',{ detail:{ referenceId } }));
  });
  const propertiesToggle = document.createElement('button'); propertiesToggle.type = 'button'; propertiesToggle.className = 'pdf-properties-toggle'; propertiesToggle.textContent = 'ⓘ'; propertiesToggle.title = 'Item properties'; propertiesToggle.setAttribute('aria-label','Toggle item properties'); propertiesToggle.setAttribute('aria-expanded','false');
  propertiesToggle.addEventListener('click',() => { const open=propertiesToggle.getAttribute('aria-expanded')!=='true';propertiesToggle.setAttribute('aria-expanded',String(open));if(open){shell.classList.remove('annotations-open');toggle.setAttribute('aria-expanded','false');}window.dispatchEvent(new CustomEvent('seshat:toggle-properties',{ detail:{ referenceId,open } })); });
  const structureToggle = document.createElement('button'); structureToggle.type = 'button'; structureToggle.className = 'pdf-structure-toggle'; structureToggle.textContent = '§'; structureToggle.title = 'Document structure'; structureToggle.setAttribute('aria-label','Toggle document structure'); structureToggle.setAttribute('aria-expanded','false');
  structureToggle.addEventListener('click',() => { const open=structureToggle.getAttribute('aria-expanded')!=='true';structureToggle.setAttribute('aria-expanded',String(open));if(open){shell.classList.remove('annotations-open');toggle.setAttribute('aria-expanded','false');}window.dispatchEvent(new CustomEvent('seshat:toggle-structure',{ detail:{ referenceId,open } })); });
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
  pages.appendChild(progress); shell.append(viewer, sidebar, toggle, propertiesToggle, structureToggle); element.replaceChildren(shell);

  let annotations: Annotation[] = [];
  let pending: PdfAnchor | null = null;
  let disposed = false;
  const phoneResourceProfile = currentPhoneResourceProfile();
  const parent = element.parentElement || element;
  const dialogs = new Set<HTMLDialogElement>();
  const renderTasks = new Set<{ cancel: () => void }>();
  const loadingTask = getDocument({ url: sourceUrl, withCredentials: true });
  const textOverlayPromise:Promise<DjvuTextLayer|null>=textOverlayUrl
    ? fetch(textOverlayUrl,{cache:'no-store'}).then((response)=>response.ok?response.json():null).catch(()=>null)
    : Promise.resolve(null);
  const [pdf,djvuTextLayer] = await Promise.all([loadingTask.promise,textOverlayPromise]);
  if (disposed) { await pdf.destroy(); return () => undefined; }
  const [annotationResponse,readingStateResponse] = await Promise.all([
    fetch(`/api/library/${referenceId}/annotations`),
    fetch(`/api/library/${referenceId}/reading-state`,{cache:'no-store'}),
  ]);
  if (annotationResponse.ok) annotations = (await annotationResponse.json()).annotations || [];
  const readingState=readingStateResponse.ok?await readingStateResponse.json() as {location?:ReadingLocation;preferences?:Record<string,unknown>}:{location:{},preferences:{}};
  let readingLocation:ReadingLocation=readingState.location||{};const readingPreferences=readingState.preferences||{};let readingSaveTimer=0;let readingPersistReady=false;
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
  let commentTouch = 0;
  comment.addEventListener('pointerup', (event) => { event.stopPropagation(); if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return; event.preventDefault(); commentTouch = performance.now(); if (pending) openComposer(pending); });
  comment.addEventListener('click', (event) => { event.stopPropagation(); if (performance.now() - commentTouch < 700) return; if (pending) openComposer(pending); }); palette.appendChild(comment); document.body.appendChild(palette);

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

  let phoneRenderQueue = Promise.resolve();
  const schedulePageRender = (pageElement: HTMLElement) => {
    if (!phoneResourceProfile) { void renderPage(pageElement); return; }
    phoneRenderQueue = phoneRenderQueue.then(() => renderPage(pageElement)).catch(() => undefined);
  };
  const observer = new IntersectionObserver((entries) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      const pageElement = entry.target as HTMLElement; observer.unobserve(pageElement); schedulePageRender(pageElement);
    });
  }, { root: viewer, rootMargin: phoneResourceProfile ? '240px 0px' : '800px 0px' });

  const renderPage = async (pageElement: HTMLElement) => {
    const pageNumber = Number(pageElement.dataset.page); const page = await pdf.getPage(pageNumber); if (disposed) return;
    const viewport = page.getViewport({ scale: Number(pageElement.dataset.scale) });
    pageElement.style.width = `${viewport.width}px`; pageElement.style.height = `${viewport.height}px`;
    const canvas = pageElement.querySelector<HTMLCanvasElement>('canvas')!; const context = canvas.getContext('2d')!;
    const outputScale = phoneResourceProfile ? Math.min(window.devicePixelRatio || 1, 1.5) : window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale); canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
    const task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
    renderTasks.add(task); await task.promise.catch(() => undefined); renderTasks.delete(task); if (disposed) return;
    const textLayerElement = pageElement.querySelector<HTMLElement>('.textLayer')!;
    const overlay=djvuTextLayer?.pages?.[pageNumber-1];
    if(overlay?.words?.length){
      textLayerElement.replaceChildren();
      for(const word of overlay.words){const span=document.createElement('span');span.className='djvu-text-word';span.textContent=`${word.text} `;span.style.left=`${(word.x0/overlay.width)*100}%`;span.style.top=`${((overlay.height-word.y1)/overlay.height)*100}%`;span.style.width=`${((word.x1-word.x0)/overlay.width)*100}%`;span.style.height=`${((word.y1-word.y0)/overlay.height)*100}%`;span.style.setProperty('--font-height',String(((word.y1-word.y0)/overlay.height)*base.height));textLayerElement.appendChild(span);}
    }else{
      const textLayer = new TextLayer({ textContentSource: await page.getTextContent(), container: textLayerElement, viewport });
      await textLayer.render();
    }
    renderHighlights(pageElement); pageElement.classList.add('rendered');
    parent.dispatchEvent(new CustomEvent('seshat:pdf-page-rendered',{detail:{page:pageNumber}}));
  };

  const firstPage = await pdf.getPage(1); const base = firstPage.getViewport({ scale: 1 });
  const available = phoneResourceProfile ? Math.max(240, viewer.clientWidth - 16) : Math.max(480, viewer.clientWidth - 72);
  const scale = Math.max(phoneResourceProfile ? .4 : .75, Math.min(1.65, available / base.width));
  const phoneViewport = firstPage.getViewport({ scale });
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = phoneResourceProfile ? null : pageNumber === 1 ? firstPage : await pdf.getPage(pageNumber);
    const viewport = page ? page.getViewport({ scale }) : phoneViewport;
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
    const mobileLift = window.matchMedia('(pointer: coarse)').matches ? 58 : 8;
    palette.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`; palette.style.top = `${Math.max(8, rect.top - bounds.height - mobileLift)}px`;
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
    form.append(head, quote, colors, typeLabel, targetLabel, noteLabel, footer); dialog.appendChild(form);
    const parentContainer = document.fullscreenElement || document.querySelector('.maximized-pod') || document.body;
    parentContainer.appendChild(dialog);
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
  viewer.addEventListener('mouseup', () => window.setTimeout(showPalette));
  viewer.addEventListener('touchend', () => window.setTimeout(showPalette));
  document.addEventListener('keydown', keyboard); window.addEventListener('seshat:annotations-changed', changed);

  // Local pinch-to-zoom for PDF pages with midpoint scroll-centering
  let touchStartDist = 0;
  let currentZoom = 1.0;
  let zoomStart = 1.0;
  let touchCenterX = 0;
  let touchCenterY = 0;
  let contentX = 0;
  let contentY = 0;

  viewer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDist = Math.sqrt(dx * dx + dy * dy);
      zoomStart = currentZoom;

      const rect = viewer.getBoundingClientRect();
      touchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      touchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      contentX = (viewer.scrollLeft + touchCenterX) / currentZoom;
      contentY = (viewer.scrollTop + touchCenterY) / currentZoom;
    }
  }, { passive: false });

  viewer.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (touchStartDist > 0) {
        const factor = dist / touchStartDist;
        currentZoom = Math.max(0.5, Math.min(3.0, zoomStart * factor));
        pages.style.zoom = String(currentZoom);
        if (!('zoom' in document.documentElement.style)) {
          pages.style.transform = `scale(${currentZoom})`;
          pages.style.transformOrigin = 'top left';
        }
        viewer.scrollLeft = contentX * currentZoom - touchCenterX;
        viewer.scrollTop = contentY * currentZoom - touchCenterY;
      }
    }
  }, { passive: false });

  viewer.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) {
      touchStartDist = 0;
    }
  }, { passive: true });

  viewer.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const rect = viewer.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const px = (viewer.scrollLeft + mouseX) / currentZoom;
      const py = (viewer.scrollTop + mouseY) / currentZoom;

      const delta = -e.deltaY * 0.01;
      currentZoom = Math.max(0.5, Math.min(3.0, currentZoom + delta));
      pages.style.zoom = String(currentZoom);
      if (!('zoom' in document.documentElement.style)) {
        pages.style.transform = `scale(${currentZoom})`;
        pages.style.transformOrigin = 'top left';
      }
      viewer.scrollLeft = px * currentZoom - mouseX;
      viewer.scrollTop = py * currentZoom - mouseY;
    }
  }, { passive: false });

  const handleZoomReset = () => {
    pages.style.zoom = '1';
    pages.style.transform = '';
    // Measure at the rendered base scale, then fit the active page or its
    // complete facing-page spread into the pod's current reading width.
    void pages.offsetWidth;
    const doublePage = pages.classList.contains('double-page-view');
    const spreadStart = pdfSpreadStart(currentPage, doublePage);
    const spreadPages = doublePage
      ? (spreadStart === 1 ? [1] : [spreadStart, Math.min(total, spreadStart + 1)])
      : [currentPage];
    const targets = spreadPages
      .map((page) => pages.querySelector<HTMLElement>(`[data-page="${page}"]`))
      .filter((page): page is HTMLElement => Boolean(page));
    if (!targets.length) return;
    const left = Math.min(...targets.map((page) => page.offsetLeft));
    const right = Math.max(...targets.map((page) => page.offsetLeft + page.offsetWidth));
    const top = Math.min(...targets.map((page) => page.offsetTop));
    const width = Math.max(1, right - left);
    currentZoom = Math.max(.25, Math.min(3, (viewer.clientWidth - 32) / width));
    pages.style.zoom = String(currentZoom);
    if (!('zoom' in document.documentElement.style)) {
      pages.style.transform = `scale(${currentZoom})`;
      pages.style.transformOrigin = 'top left';
    }
    void pages.offsetWidth;
    const centerX = ((left + right) / 2) * currentZoom;
    viewer.scrollTo({
      left: Math.max(0, centerX - viewer.clientWidth / 2),
      top: Math.max(0, top * currentZoom - 16),
      behavior: 'auto',
    });
  };

  const handleGotoPage = (e: any) => {
    const doublePage = pages.classList.contains('double-page-view') && !pages.classList.contains('mosaic-page-view');
    const requested = Number(e.detail.page);
    const pageNum = pdfSpreadStart(Math.max(1, Math.min(pdf.numPages, requested)), doublePage);
    const pageEl = pages.querySelector<HTMLElement>(`[data-page="${pageNum}"]`);
    if (pageEl) {
      viewer.scrollTo({
        top: pdfPageScrollTop(pageEl.offsetTop, currentZoom, 8),
        behavior: e.detail.behavior === 'auto' ? 'auto' : 'smooth'
      });
    }
  };
  const handleReferencePage = (event: Event) => {
    const detail = (event as CustomEvent<{ referenceId?: string; page?: number }>).detail;
    if (detail?.referenceId !== referenceId || !detail.page) return;
    pendingPdfPages.delete(referenceId);
    handleGotoPage({ detail });
  };

  const handleToggleDouble = (e: any) => {
    const active = e.detail.active;
    pages.classList.toggle('double-page-view', active);
    viewer.dispatchEvent(new Event('scroll'));
  };

  const handleToggleMosaic = (e: any) => {
    const active = e.detail.active;
    pages.classList.toggle('mosaic-page-view', active);
    viewer.dispatchEvent(new Event('scroll'));
  };

  const handleToggleInvert = (e: any) => {
    const active = e.detail.active;
    viewer.classList.toggle('inverted-doc-parent', active);
    pages.classList.toggle('inverted-doc', active);
  };

  parent.addEventListener('seshat:pdf-zoom-reset', handleZoomReset);
  parent.addEventListener('seshat:pdf-goto-page', handleGotoPage);
  parent.addEventListener('seshat:pdf-toggle-double', handleToggleDouble);
  parent.addEventListener('seshat:pdf-toggle-mosaic', handleToggleMosaic);
  parent.addEventListener('seshat:doc-toggle-invert', handleToggleInvert);
  window.addEventListener('seshat:pdf-goto-reference-page', handleReferencePage);
  const pendingPage = pendingPdfPages.get(referenceId);
  if (pendingPage) handleReferencePage(new CustomEvent('pending', { detail: { referenceId, page: pendingPage } }));

  // Active page change observer
  const total = pdf.numPages;
  const savedPage=Math.max(1,Math.min(total,Math.floor(Number(pendingPage||readingLocation.lastPage||readingLocation.page||1))));
  let currentPage = savedPage;
  const writeReadingState=()=>{
    readingLocation=updateReadingLocation(readingLocation,{format:'pdf',page:currentPage,lastPage:currentPage,totalPages:total});
    return fetch(`/api/library/${referenceId}/reading-state`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({location:readingLocation,preferences:readingPreferences}),keepalive:true}).catch(()=>undefined);
  };
  const persistPage=(page:number)=>{
    if(!readingPersistReady)return;
    window.clearTimeout(readingSaveTimer);readingSaveTimer=window.setTimeout(()=>{
      currentPage=page;void writeReadingState();
    },500);
  };
  const announcePage=(page:number)=>{parent.dispatchEvent(new CustomEvent('seshat:pdf-page-changed',{detail:{page,total}}));persistPage(page);};
  const readerKeyboard = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.matches('input,textarea,select,[contenteditable="true"]')) return;
    let page: number | null = null;
    const doublePage = pages.classList.contains('double-page-view') && !pages.classList.contains('mosaic-page-view');
    if (event.key === 'ArrowLeft') page = adjacentPdfPage(currentPage, -1, total, doublePage);
    else if (event.key === 'ArrowRight') page = adjacentPdfPage(currentPage, 1, total, doublePage);
    else if (event.key === '0') page = 1;
    else if (event.key === 'G') page = total;
    else if (event.key === '1' && !pending) { event.preventDefault(); parent.dispatchEvent(new CustomEvent('seshat:pdf-zoom-reset')); return; }
    else if (event.key === 'g') { event.preventDefault(); parent.dispatchEvent(new CustomEvent('seshat:pdf-request-mode',{ detail:{ mode:'grid' } })); return; }
    else if (event.key === 'b') { event.preventDefault(); parent.dispatchEvent(new CustomEvent('seshat:pdf-request-mode',{ detail:{ mode:'book' } })); return; }
    if (page === null) return;
    event.preventDefault(); parent.dispatchEvent(new CustomEvent('seshat:pdf-goto-page', { detail: { page: Math.max(1, Math.min(total, page)) } }));
  };
  viewer.addEventListener('keydown', readerKeyboard);
  viewer.addEventListener('pointerdown', () => viewer.focus({ preventScroll: true }));
  const pageChangeObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting);
    if (visible.length > 0) {
      visible.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      const pageNum = Number((visible[0].target as HTMLElement).dataset.page);
      if(!readingPersistReady&&savedPage>1&&pageNum!==savedPage)return;
      currentPage = pageNum;
      announcePage(pageNum);
    }
  }, { root: viewer, threshold: 0.15 });

  pages.querySelectorAll<HTMLElement>('.seshat-pdf-page').forEach((pageEl) => {
    pageChangeObserver.observe(pageEl);
  });

  // Margin invisible page turning areas (25% left/right edges)
  const handleMarginClicks = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select, .annotation-surface, .annotation-comment-form')) return;
    const selection = window.getSelection();
    if (selection && selection.toString().trim().length > 0) return;

    const rect = viewer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;

    const doublePage = pages.classList.contains('double-page-view') && !pages.classList.contains('mosaic-page-view');
    if (ratio < 0.25) {
      parent.dispatchEvent(new CustomEvent('seshat:pdf-goto-page', { detail: { page: adjacentPdfPage(currentPage, -1, total, doublePage) } }));
    } else if (ratio > 0.75) {
      parent.dispatchEvent(new CustomEvent('seshat:pdf-goto-page', { detail: { page: adjacentPdfPage(currentPage, 1, total, doublePage) } }));
    }
  };

  // Double tap/click to reset zoom to 1:1
  const handleDoubleClicks = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input, select')) return;
    parent.dispatchEvent(new CustomEvent('seshat:pdf-zoom-reset'));
  };

  viewer.addEventListener('click', handleMarginClicks);
  viewer.addEventListener('dblclick', handleDoubleClicks);

  // Restore and announce the last visible page before accepting new progress.
  announcePage(savedPage);
  window.requestAnimationFrame(()=>{handleGotoPage({detail:{page:savedPage,behavior:'auto'}});window.setTimeout(()=>{readingPersistReady=true;announcePage(currentPage);},300);});

  return () => {
    disposed = true;
    window.clearTimeout(readingSaveTimer);if(readingPersistReady)void writeReadingState();
    observer.disconnect();
    pageChangeObserver.disconnect();
    renderTasks.forEach((task) => task.cancel());
    disposeIndex();
    palette.remove();
    dialogs.forEach((dialog) => dialog.remove());
    document.removeEventListener('keydown', keyboard);
    window.removeEventListener('seshat:annotations-changed', changed);
    parent.removeEventListener('seshat:pdf-zoom-reset', handleZoomReset);
    parent.removeEventListener('seshat:pdf-goto-page', handleGotoPage);
    parent.removeEventListener('seshat:pdf-toggle-double', handleToggleDouble);
    parent.removeEventListener('seshat:pdf-toggle-mosaic', handleToggleMosaic);
    parent.removeEventListener('seshat:doc-toggle-invert', handleToggleInvert);
    window.removeEventListener('seshat:pdf-goto-reference-page', handleReferencePage);
    viewer.removeEventListener('click', handleMarginClicks);
    viewer.removeEventListener('dblclick', handleDoubleClicks);
    viewer.removeEventListener('keydown', readerKeyboard);
    void pdf.destroy();
  };
}
