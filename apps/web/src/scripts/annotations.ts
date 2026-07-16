export type Annotation = {
  id: string; referenceId: string; quote: string; prefix: string; suffix: string;
  startOffset: number; endOffset: number; sourceKind: string; rects: Array<{ x: number; y: number; width: number; height: number }>; page?: number; locator?: string;
  color: string; category: string; noteType?: string; note?: string;
  tags: string[]; targets: string[]; reviewStatus: string; createdAt: string; updatedAt: string;
};

type SelectionAnchor = { quote: string; prefix: string; suffix: string; startOffset: number; endOffset: number };
type AnnotationColor = { hex: string; name: string; category: string; label: string; sigil: string };

export const annotationColors: AnnotationColor[] = [
  { hex: '#2ea8e5', name: 'blue', category: 'concept', label: 'Concept / Interesting', sigil: 'CON' },
  { hex: '#5fb236', name: 'green', category: 'main-idea', label: 'Main Ideas / Key Themes / Definitions', sigil: 'MAIN' },
  { hex: '#a28ae5', name: 'purple', category: 'research-development', label: 'Development / Methods / General Research', sigil: 'DEV' },
  { hex: '#ffd400', name: 'yellow', category: 'evidence', label: 'Data / Meaning / Persons / Works', sigil: 'DATA' },
  { hex: '#ff6666', name: 'red', category: 'question-opposition', label: 'Questions / Opposite', sigil: 'Q' },
  { hex: '#f19837', name: 'orange', category: 'methodology', label: 'Methodologies', sigil: 'MTD' },
  { hex: '#e56eee', name: 'magenta', category: 'connection', label: 'Connections / Relations', sigil: 'REL' },
  { hex: '#aaaaaa', name: 'grey', category: 'misc', label: 'Context / Misc', sigil: 'MISC' },
];

const colorFor = (annotation: Pick<Annotation, 'color'>) => annotationColors.find((item) => item.hex === annotation.color) || annotationColors[7];
const commaList = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);

export async function mountAnnotationWorkspace(
  element: HTMLElement,
  referenceId: string,
  title: string,
  report: (message: string, tone?: 'ready' | 'saving' | 'error') => void,
  options: { indexOnly?: boolean; initialEditId?: string } = {},
): Promise<() => void> {
  element.classList.add('annotation-workspace');
  element.innerHTML = '<div class="annotation-loading">Loading extracted text and annotations…</div>';
  const [textResponse, annotationResponse] = await Promise.all([
    options.indexOnly ? Promise.resolve(null) : fetch(`/api/library/${referenceId}/artifact/markdown`),
    fetch(`/api/library/${referenceId}/annotations`),
  ]);
  if (textResponse && !textResponse.ok) { element.innerHTML = '<div class="annotation-loading">Extracted text is not available yet.</div>'; return () => undefined; }
  if (!annotationResponse.ok) { element.innerHTML = '<div class="annotation-loading">Annotations could not be loaded.</div>'; return () => undefined; }
  const source = textResponse ? await textResponse.text() : '';
  const annotations: Annotation[] = (await annotationResponse.json()).annotations || [];
  if (!options.indexOnly) annotations.filter((annotation) => annotation.sourceKind === 'markdown').forEach((annotation) => {
    if (source.slice(annotation.startOffset, annotation.endOffset) === annotation.quote) return;
    const candidates: number[] = []; let offset = source.indexOf(annotation.quote);
    while (offset >= 0 && candidates.length < 100) { candidates.push(offset); offset = source.indexOf(annotation.quote, offset + 1); }
    const best = candidates.sort((a, b) => {
      const score = (position: number) => (annotation.prefix && source.slice(Math.max(0, position - annotation.prefix.length), position) === annotation.prefix ? 2 : 0)
        + (annotation.suffix && source.slice(position + annotation.quote.length, position + annotation.quote.length + annotation.suffix.length) === annotation.suffix ? 1 : 0);
      return score(b) - score(a);
    })[0];
    if (best !== undefined) { annotation.startOffset = best; annotation.endOffset = best + annotation.quote.length; }
    else { annotation.startOffset = -1; annotation.endOffset = -1; }
  });
  let pending: SelectionAnchor | null = null;
  let activeId: string | null = null;

  const header = document.createElement('header'); header.className = 'annotation-head';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('span'); eyebrow.textContent = options.indexOnly ? 'Annotation index' : 'Semantic annotation';
  const h2 = document.createElement('h2'); h2.textContent = title; heading.append(eyebrow, h2);
  const stats = document.createElement('div'); stats.className = 'annotation-stats'; header.append(heading, stats);
  const body = document.createElement('div'); body.className = 'annotation-body';
  const reading = document.createElement('div'); reading.className = 'annotation-reading';
  const surface = document.createElement('div'); surface.className = 'annotation-surface'; surface.tabIndex = 0; reading.appendChild(surface);
  const rail = document.createElement('aside'); rail.className = 'annotation-rail';
  const railHead = document.createElement('header'); railHead.innerHTML = '<strong>Annotations</strong><span>Reading marks · click or contextual menu to classify</span>';
  const editorHost = document.createElement('div'); editorHost.className = 'annotation-editor-host'; editorHost.hidden = true;
  const cards = document.createElement('div'); cards.className = 'annotation-cards'; rail.append(railHead, editorHost, cards);
  if (options.indexOnly) { element.classList.add('annotation-index-only'); body.appendChild(rail); }
  else body.append(reading, rail);
  element.replaceChildren(header, body);

  const palette = document.createElement('div'); palette.className = 'annotation-palette'; palette.hidden = true;
  annotationColors.forEach((color, index) => {
    const button = document.createElement('button'); button.type = 'button'; button.style.setProperty('--annotation-color', color.hex);
    button.title = `${index + 1} · ${color.label}`; button.setAttribute('aria-label', button.title); button.dataset.color = color.hex;
    const dot = document.createElement('i'); const key = document.createElement('small'); key.textContent = String(index + 1); button.append(dot, key);
    button.addEventListener('click', () => { if (pending) void createAnnotation(pending, color); }); palette.appendChild(button);
  });
  const comment = document.createElement('button'); comment.type = 'button'; comment.className = 'annotation-comment'; comment.textContent = 'M'; comment.title = 'Add comment and metadata';
  let commentTouch = 0;
  comment.addEventListener('pointerup', (event) => { event.stopPropagation(); if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return; event.preventDefault(); commentTouch = performance.now(); if (pending) openEditor(undefined, pending); });
  comment.addEventListener('click', (event) => { event.stopPropagation(); if (performance.now() - commentTouch < 700) return; if (pending) openEditor(undefined, pending); }); palette.appendChild(comment);
  document.body.appendChild(palette);

  const render = () => {
    if (!options.indexOnly) surface.replaceChildren();
    const valid = annotations.filter((item) => item.sourceKind === 'markdown' && item.startOffset >= 0 && item.endOffset <= source.length && item.endOffset > item.startOffset)
      .sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
    let cursor = 0;
    valid.forEach((annotation) => {
      if (annotation.startOffset < cursor) return;
      surface.append(document.createTextNode(source.slice(cursor, annotation.startOffset)));
      const mark = document.createElement('mark'); const color = colorFor(annotation);
      mark.textContent = source.slice(annotation.startOffset, annotation.endOffset);
      mark.style.setProperty('--annotation-color', color.hex); mark.dataset.annotationId = annotation.id;
      const readingMark = annotation.noteType === 'reading-mark';
      mark.dataset.sigil = readingMark ? 'READ' : color.sigil; mark.title = readingMark ? 'Reading mark · click to classify' : color.label;
      mark.classList.toggle('active', activeId === annotation.id);
      mark.addEventListener('click', (event) => { event.stopPropagation(); activeId = annotation.id; render(); openEditor(annotation); });
      mark.addEventListener('contextmenu', (event) => { event.preventDefault(); event.stopPropagation(); activeId = annotation.id; render(); openEditor(annotation); });
      surface.appendChild(mark); cursor = annotation.endOffset;
    });
    if (!options.indexOnly) surface.append(document.createTextNode(source.slice(cursor)));

    cards.replaceChildren();
    annotations.forEach((annotation) => {
      const color = colorFor(annotation); const card = document.createElement('article'); card.style.setProperty('--annotation-color', color.hex);
      card.classList.toggle('active', activeId === annotation.id); card.dataset.annotationId = annotation.id;
      const readingMark = annotation.noteType === 'reading-mark';
      const meta = document.createElement('header'); const category = document.createElement('span'); category.textContent = readingMark ? `READ · ${color.label}` : `${color.sigil} · ${color.label}`;
      const status = document.createElement('small'); status.textContent = annotation.reviewStatus; meta.append(category, status);
      const quote = document.createElement('blockquote'); quote.textContent = annotation.quote;
      card.append(meta, quote);
      if (annotation.note) { const note = document.createElement('p'); note.textContent = annotation.note; card.appendChild(note); }
      card.addEventListener('click', () => {
        activeId = annotation.id; render();
        if (!options.indexOnly) surface.querySelector<HTMLElement>(`[data-annotation-id="${CSS.escape(annotation.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        openEditor(annotation);
      });
      card.addEventListener('contextmenu', (event) => { event.preventDefault(); activeId = annotation.id; render(); openEditor(annotation); }); cards.appendChild(card);
    });
    stats.replaceChildren();
    annotationColors.forEach((color) => {
      const count = annotations.filter((item) => item.category === color.category).length; if (!count) return;
      const item = document.createElement('span'); item.style.setProperty('--annotation-color', color.hex); item.textContent = `${color.sigil} ${count}`; stats.appendChild(item);
    });
  };

  const selectorFromSelection = (): SelectionAnchor | null => {
    const selection = window.getSelection(); if (!selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!surface.contains(range.commonAncestorContainer)) return null;
    const before = document.createRange(); before.selectNodeContents(surface); before.setEnd(range.startContainer, range.startOffset);
    const startOffset = before.toString().length; const quote = range.toString(); const endOffset = startOffset + quote.length;
    if (!quote.trim() || endOffset <= startOffset) return null;
    return { quote: source.slice(startOffset, endOffset), startOffset, endOffset,
      prefix: source.slice(Math.max(0, startOffset - 250), startOffset), suffix: source.slice(endOffset, endOffset + 250) };
  };

  const showPalette = () => {
    pending = selectorFromSelection();
    if (!pending) { palette.hidden = true; return; }
    const selection = window.getSelection(); const rect = selection!.getRangeAt(0).getBoundingClientRect(); palette.hidden = false;
    const bounds = palette.getBoundingClientRect();
    const mobileLift = window.matchMedia('(pointer: coarse)').matches ? 58 : 8;
    palette.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8))}px`;
    palette.style.top = `${Math.max(8, rect.top - bounds.height - mobileLift)}px`;
  };

  async function createAnnotation(anchor: SelectionAnchor, color: AnnotationColor, details: Record<string, unknown> = {}): Promise<boolean> {
    palette.hidden = true; report('saving annotation…', 'saving');
    const response = await fetch(`/api/library/${referenceId}/annotations`, {
      method: 'POST', headers: {'content-type':'application/json'},
      body: JSON.stringify({ ...anchor, color: color.hex, category: color.category, ...details }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { report(result.error || 'Annotation could not be saved', 'error'); return false; }
    annotations.push(result.annotation); activeId = result.annotation.id; pending = null; window.getSelection()?.removeAllRanges(); render(); report('annotation saved');
    window.dispatchEvent(new CustomEvent('seshat:annotations-changed', { detail: { referenceId } }));
    return true;
  }

  async function updateAnnotation(annotation: Annotation, details: Record<string, unknown>): Promise<boolean> {
    report('saving annotation…', 'saving');
    const response = await fetch(`/api/library/${referenceId}/annotations/${annotation.id}`, {
      method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify(details),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { report(result.error || 'Annotation could not be updated', 'error'); return false; }
    Object.assign(annotation, result.annotation); render(); report('annotation saved');
    window.dispatchEvent(new CustomEvent('seshat:annotations-changed', { detail: { referenceId } }));
    return true;
  }

  async function deleteAnnotation(annotation: Annotation) {
    const response = await fetch(`/api/library/${referenceId}/annotations/${annotation.id}`, { method: 'DELETE' });
    if (!response.ok) { report('Annotation could not be deleted', 'error'); return; }
    annotations.splice(annotations.indexOf(annotation), 1); activeId = null; render(); report('annotation deleted');
    window.dispatchEvent(new CustomEvent('seshat:annotations-changed', { detail: { referenceId } }));
  }

  const closeEditor = () => { editorHost.replaceChildren(); editorHost.hidden = true; };

  function openEditor(annotation?: Annotation, anchor?: SelectionAnchor) {
    palette.hidden = true;
    closeEditor(); editorHost.hidden = false;
    const editor = document.createElement('section'); editor.className = 'annotation-editor annotation-editor-inline';
    const form = document.createElement('form'); const readingMark = annotation?.noteType === 'reading-mark';
    const head = document.createElement('header'); const title = document.createElement('strong'); title.textContent = readingMark ? 'Classify reading mark' : annotation ? 'Edit annotation' : 'Annotate selection';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label','Close annotation editor'); close.addEventListener('click', closeEditor); head.append(title, close);
    const quote = document.createElement('blockquote'); quote.textContent = annotation?.quote || anchor?.quote || '';
    const colors = document.createElement('div'); colors.className = 'annotation-editor-colors'; let selected = colorFor(annotation || { color: annotationColors[0].hex });
    annotationColors.forEach((color) => {
      const button = document.createElement('button'); button.type = 'button'; button.style.setProperty('--annotation-color', color.hex); button.title = color.label;
      button.classList.toggle('selected', selected.hex === color.hex); button.innerHTML = `<i></i><span>${color.sigil}</span>`;
      button.addEventListener('click', () => { selected = color; colors.querySelectorAll('button').forEach((item) => item.classList.toggle('selected', item === button)); }); colors.appendChild(button);
    });
    const noteLabel = document.createElement('label'); noteLabel.className = 'annotation-editor-comment'; noteLabel.textContent = 'Comment'; const note = document.createElement('textarea'); note.rows = 4; note.value = annotation?.note || ''; noteLabel.appendChild(note);
    const grid = document.createElement('div'); grid.className = 'annotation-editor-grid';
    const noteType = selectField('Note type', [['','—'],['reading-mark','Reading mark'],['explanatory','Explanatory'],['critical','Critical'],['projective','Projective']], annotation?.noteType || '');
    if (readingMark) { noteType.input.disabled = true; noteType.input.title = 'The reading-mark type is preserved so Read can resume here.'; }
    const review = selectField('State', [['reading','Reading'],['captured','Captured'],['processed','Processed'],['citable','Citable'],['discarded','Discarded']], annotation?.reviewStatus || 'captured');
    const page = inputField('Page', annotation?.page ? String(annotation.page) : '', 'number'); const locator = inputField('Locator', annotation?.locator || '');
    const targets = inputField('Targets (comma separated)', annotation?.targets.join(', ') || ''); const tags = inputField('Tags (comma separated)', annotation?.tags.join(', ') || '');
    grid.append(noteType.label, review.label, page.label, locator.label, targets.label, tags.label);
    const actions = document.createElement('footer');
    if (annotation) { const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Delete'; remove.addEventListener('click', () => { void deleteAnnotation(annotation); closeEditor(); }); actions.appendChild(remove); }
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'Save'; actions.appendChild(save);
    form.append(head, noteLabel, colors, grid, quote, actions); editor.appendChild(form); editorHost.appendChild(editor);
    form.addEventListener('submit', async (event) => {
      event.preventDefault(); const details = { color: selected.hex, category: selected.category, noteType: readingMark ? 'reading-mark' : noteType.input.value || undefined,
        reviewStatus: review.input.value, page: page.input.value ? Number(page.input.value) : undefined, locator: locator.input.value,
        targets: commaList(targets.input.value), tags: commaList(tags.input.value), note: note.value };
      save.disabled = true;
      if (annotation) { if (await updateAnnotation(annotation, details)) closeEditor(); else save.disabled = false; }
      else if (anchor) { if (await createAnnotation(anchor, selected, details)) closeEditor(); else save.disabled = false; }
    });
    window.requestAnimationFrame(() => { note.focus(); note.setSelectionRange(note.value.length,note.value.length); editor.scrollIntoView({block:'nearest'}); });
  }

  function inputField(text: string, value: string, type = 'text') {
    const label = document.createElement('label'); label.textContent = text; const input = document.createElement('input'); input.type = type; input.value = value; label.appendChild(input); return { label, input };
  }
  function selectField(text: string, options: string[][], value: string) {
    const label = document.createElement('label'); label.textContent = text; const input = document.createElement('select');
    options.forEach(([key, name]) => { const option = document.createElement('option'); option.value = key; option.textContent = name; option.selected = key === value; input.appendChild(option); }); label.appendChild(input); return { label, input };
  }

  const keyboard = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement)?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const index = Number(event.key) - 1;
    if (index >= 0 && index < annotationColors.length && pending) { event.preventDefault(); void createAnnotation(pending, annotationColors[index]); return; }
    if (event.key.toLowerCase() === 'm' && pending) { event.preventDefault(); openEditor(undefined, pending); return; }
    const active = annotations.find((item) => item.id === activeId);
    if (event.key.toLowerCase() === 'e' && active) { event.preventDefault(); openEditor(active); }
    if (event.key.toLowerCase() === 'x' && active) { event.preventDefault(); void deleteAnnotation(active); }
  };
  const outsidePointer = (event: PointerEvent) => {
    if (!palette.contains(event.target as Node) && !surface.contains(event.target as Node)) palette.hidden = true;
  };
  const changed = async (event: Event) => {
    if ((event as CustomEvent).detail?.referenceId !== referenceId) return;
    const response = await fetch(`/api/library/${referenceId}/annotations`); if (!response.ok) return;
    annotations.splice(0, annotations.length, ...((await response.json()).annotations || [])); render();
  };
  const requestedEdit = (event: Event) => {
    const detail=(event as CustomEvent<{referenceId?:string;annotationId?:string}>).detail;
    if(detail?.referenceId!==referenceId||!detail.annotationId)return;
    const annotation=annotations.find((item)=>item.id===detail.annotationId);if(!annotation)return;
    activeId=annotation.id;render();openEditor(annotation);
  };
  if (!options.indexOnly) {
    surface.addEventListener('mouseup', () => window.setTimeout(showPalette));
    surface.addEventListener('touchend', () => window.setTimeout(showPalette));
    surface.addEventListener('keyup', (event) => { if (event.key === 'Shift' || event.key.startsWith('Arrow')) showPalette(); });

    const readingScroll = surface.closest('.annotation-reading') as HTMLElement || surface.parentElement;
    if (readingScroll) {
      let textStartDist = 0;
      let textZoom = 1.0;
      let textZoomStart = 1.0;

      readingScroll.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          textStartDist = Math.sqrt(dx * dx + dy * dy);
          textZoomStart = textZoom;
        }
      }, { passive: false });

      readingScroll.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2) {
          e.preventDefault();
          const dx = e.touches[0].clientX - e.touches[1].clientX;
          const dy = e.touches[0].clientY - e.touches[1].clientY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (textStartDist > 0) {
            const factor = dist / textStartDist;
            textZoom = Math.max(0.5, Math.min(3.0, textZoomStart * factor));
            surface.style.zoom = String(textZoom);
            if (!('zoom' in document.documentElement.style)) {
              surface.style.transform = `scale(${textZoom})`;
              surface.style.transformOrigin = 'top center';
            }
          }
        }
      }, { passive: false });

      readingScroll.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
          textStartDist = 0;
        }
      }, { passive: true });

      readingScroll.addEventListener('wheel', (e) => {
        if (e.ctrlKey) {
          e.preventDefault();
          const delta = -e.deltaY * 0.01;
          textZoom = Math.max(0.5, Math.min(3.0, textZoom + delta));
          surface.style.zoom = String(textZoom);
          if (!('zoom' in document.documentElement.style)) {
            surface.style.transform = `scale(${textZoom})`;
            surface.style.transformOrigin = 'top center';
          }
        }
      }, { passive: false });
    }
  }
  document.addEventListener('keydown', keyboard);
  document.addEventListener('pointerdown', outsidePointer);
  window.addEventListener('seshat:annotations-changed', changed);
  window.addEventListener('seshat:edit-annotation', requestedEdit);
  render();
  if(options.initialEditId){const initial=annotations.find((item)=>item.id===options.initialEditId);if(initial){activeId=initial.id;render();openEditor(initial);}}
  return () => { document.removeEventListener('keydown', keyboard); document.removeEventListener('pointerdown', outsidePointer); window.removeEventListener('seshat:annotations-changed', changed); window.removeEventListener('seshat:edit-annotation', requestedEdit); palette.remove(); closeEditor(); };
}
