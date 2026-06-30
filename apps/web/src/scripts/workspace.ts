import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview-core';

registerAllModules();

type ReferenceRow = {
  id: string; citeKey: string; type: string; title: string; authors: string; year: number | string;
  isbn: string; language: string; tags: string; abstract: string; format: string; filename: string;
  libraryIds: string[]; status: string; hasStructure: boolean; hasText: boolean;
};
type LibraryNode = { id: string; name: string; description?: string; parentId?: string; itemCount: number };
type WorkspacePayload = { references: ReferenceRow[]; libraries: LibraryNode[] };
type ToolKind = 'analysis' | 'annotation' | 'agent';

const STORAGE_KEY = 'seshat.workspace.layout.v1';
const readPayload = (): WorkspacePayload => JSON.parse(document.getElementById('seshat-workspace-data')?.textContent || '{"references":[],"libraries":[]}');
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

export function mountSeshatWorkspace(root: HTMLElement): void {
  const payload = readPayload();
  const references = new Map(payload.references.map((reference) => [reference.id, reference]));
  const host = root.querySelector<HTMLElement>('[data-dockview-host]');
  const tree = root.querySelector<HTMLElement>('[data-library-tree]');
  const search = root.querySelector<HTMLInputElement>('[data-tree-search]');
  const saveState = root.querySelector<HTMLElement>('[data-save-state]');
  if (!host || !tree || !search || !saveState) return;

  let api: DockviewApi;
  let catalogTable: Handsontable | null = null;
  let activeLibrary: string | null = null;
  let activeReference: string | null = payload.references[0]?.id || null;
  const committed = new Map(payload.references.map((reference) => [reference.id, { ...reference }]));
  const saveTimers = new Map<string, number>();

  const filteredRows = () => payload.references.filter((reference) => !activeLibrary || reference.libraryIds.includes(activeLibrary));
  const refreshTable = () => catalogTable?.loadData(filteredRows());

  const setSaveState = (state: string, tone: 'ready' | 'saving' | 'error' = 'ready') => {
    saveState.textContent = state;
    saveState.dataset.tone = tone;
  };

  const saveReference = async (row: ReferenceRow) => {
    setSaveState('saving…', 'saving');
    const form = new FormData();
    form.set('title', row.title);
    form.set('authors', row.authors);
    form.set('year', String(row.year || ''));
    form.set('isbns', row.isbn);
    form.set('citeKey', row.citeKey);
    form.set('type', row.type);
    form.set('language', row.language);
    form.set('tags', row.tags);
    form.set('abstract', row.abstract);
    const response = await fetch(`/api/library/${row.id}/metadata`, { method: 'POST', body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Save failed');
    committed.set(row.id, { ...row });
    setSaveState('saved', 'ready');
    window.setTimeout(() => setSaveState('ready'), 1500);
  };

  const scheduleSave = (row: ReferenceRow) => {
    const existing = saveTimers.get(row.id);
    if (existing) window.clearTimeout(existing);
    saveTimers.set(row.id, window.setTimeout(async () => {
      saveTimers.delete(row.id);
      try { await saveReference(row); }
      catch (error) {
        const previous = committed.get(row.id);
        if (previous) Object.assign(row, previous);
        refreshTable();
        setSaveState(error instanceof Error ? error.message : 'save failed', 'error');
      }
    }, 500));
  };

  const mountCatalog = (element: HTMLElement) => {
    if (catalogTable || !element.isConnected) return;
    element.classList.add('ht-theme-main');
    catalogTable = new Handsontable(element, {
      data: filteredRows(),
      columns: [
        { data: 'title', title: 'Title', width: 300 },
        { data: 'authors', title: 'Authors', width: 220 },
        { data: 'year', title: 'Year', type: 'numeric', width: 72 },
        { data: 'type', title: 'Type', type: 'dropdown', source: ['document','article','article-journal','book','chapter','paper-conference','report','thesis'], width: 130 },
        { data: 'isbn', title: 'ISBN', width: 150 },
        { data: 'language', title: 'Lang', width: 70 },
        { data: 'tags', title: 'Tags', width: 190 },
        { data: 'citeKey', title: 'Citekey', width: 160 },
        { data: 'abstract', title: 'Abstract', width: 320 },
        { data: 'format', title: 'File', readOnly: true, width: 65 },
        { data: 'status', title: 'State', readOnly: true, width: 92 },
      ],
      rowHeaders: true,
      rowHeights: 28,
      columnHeaderHeight: 30,
      width: '100%',
      height: '100%',
      stretchH: 'none',
      fixedColumnsStart: 2,
      filters: true,
      dropdownMenu: true,
      multiColumnSorting: true,
      manualColumnMove: true,
      manualColumnResize: true,
      copyPaste: true,
      fillHandle: true,
      contextMenu: true,
      outsideClickDeselects: false,
      licenseKey: 'non-commercial-and-evaluation',
      afterChange: (changes, source) => {
        if (!changes?.length || ['loadData', 'rollback'].includes(String(source))) return;
        const touched = new Set<string>();
        for (const [visualRow] of changes) {
          const physicalRow = catalogTable?.toPhysicalRow(Number(visualRow)) ?? Number(visualRow);
          const row = catalogTable?.getSourceDataAtRow(physicalRow) as ReferenceRow | undefined;
          if (row?.id) touched.add(row.id);
        }
        touched.forEach((id) => { const row = references.get(id); if (row) scheduleSave(row); });
      },
      afterOnCellMouseDown: (event, coords) => {
        if (event.detail !== 2 || coords.row < 0) return;
        const physicalRow = catalogTable?.toPhysicalRow(coords.row) ?? coords.row;
        const row = catalogTable?.getSourceDataAtRow(physicalRow) as ReferenceRow | undefined;
        if (row) controller.openDocument(row.id);
      },
    });
  };

  const panel = (className: string): HTMLElement => {
    const element = document.createElement('section');
    element.className = `workspace-pod ${className}`;
    return element;
  };

  const podToolbar = (reference: ReferenceRow): HTMLElement => {
    const toolbar = document.createElement('header');
    toolbar.className = 'pod-toolbar';
    const label = document.createElement('span');
    label.textContent = `${reference.format.toUpperCase()} · ${reference.filename}`;
    toolbar.appendChild(label);
    const actions: Array<[string, string]> = [['text','Text'],['structure','Structure'],['analysis','Analysis'],['annotation','Annotate'],['agent','Agent']];
    for (const [kind, title] of actions) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = title;
      button.addEventListener('click', () => kind === 'text' || kind === 'structure'
        ? controller.openDerivative(reference.id, kind) : controller.openTool(kind as ToolKind, reference.id));
      toolbar.appendChild(button);
    }
    const original = document.createElement('a');
    original.href = `/api/library/${reference.id}/original`; original.target = '_blank'; original.textContent = 'Original ↗';
    toolbar.appendChild(original);
    return toolbar;
  };

  const documentRenderer = (referenceId: string): IContentRenderer => {
    const element = panel('document-pod');
    return { element, init() {
      const reference = references.get(referenceId);
      if (!reference) { element.textContent = 'Reference not found.'; return; }
      activeReference = referenceId;
      element.appendChild(podToolbar(reference));
      const body = document.createElement('div'); body.className = 'pod-document-body'; element.appendChild(body);
      if (reference.format === 'pdf') {
        const frame = document.createElement('iframe'); frame.src = `/api/library/${reference.id}/original`; frame.title = reference.title; body.appendChild(frame);
      } else {
        void mountText(body, reference.id, 'markdown');
      }
    } };
  };

  const mountText = async (element: HTMLElement, referenceId: string, kind: 'markdown' | 'structure') => {
    element.classList.add('pod-reading-surface');
    const response = await fetch(`/api/library/${referenceId}/artifact/${kind}`);
    if (!response.ok) { element.textContent = kind === 'structure' ? 'Structure is not available yet.' : 'Extracted text is not available yet.'; return; }
    if (kind === 'structure') {
      const data = await response.json();
      const list = document.createElement('ol'); list.className = 'pod-outline';
      for (const section of (data.sections || []).slice(0, 1000)) {
        const item = document.createElement('li'); item.style.paddingLeft = `${Math.min(5, Math.max(0, Number(section.level) - 1)) * 18}px`; item.textContent = section.title; list.appendChild(item);
      }
      element.appendChild(list);
    } else {
      const pre = document.createElement('pre'); pre.textContent = await response.text(); element.appendChild(pre);
    }
  };

  const derivativeRenderer = (referenceId: string, kind: 'text' | 'structure'): IContentRenderer => {
    const element = panel(`${kind}-pod`);
    return { element, init() { void mountText(element, referenceId, kind === 'text' ? 'markdown' : 'structure'); } };
  };

  const toolRenderer = (kind: ToolKind, referenceId?: string): IContentRenderer => {
    const element = panel('future-tool-pod');
    return { element, init() {
      const reference = referenceId ? references.get(referenceId) : undefined;
      const glyph = kind === 'analysis' ? '⌁' : kind === 'annotation' ? '✎' : '✣';
      const heading = document.createElement('div'); heading.className = 'future-tool-glyph'; heading.textContent = glyph; element.appendChild(heading);
      const title = document.createElement('h2'); title.textContent = kind === 'agent' ? 'Agent workspace' : `${kind[0].toUpperCase()}${kind.slice(1)} workspace`; element.appendChild(title);
      const copy = document.createElement('p'); copy.textContent = reference
        ? `Context attached to “${reference.title}”. This pod slot is ready for its own lifecycle and persistence.`
        : 'Open a document first to attach evidence and provenance to this pod.'; element.appendChild(copy);
    } };
  };

  api = createDockview(host, {
    className: 'seshat-dockview',
    createComponent: (options) => {
      const name = options.name;
      if (name === 'catalog') {
        const element = panel('catalog-pod');
        return { element, init() { window.requestAnimationFrame(() => mountCatalog(element)); }, dispose() {
          catalogTable?.destroy();
          catalogTable = null;
        } };
      }
      if (name.startsWith('document:')) return documentRenderer(name.slice('document:'.length));
      if (name.startsWith('text:')) return derivativeRenderer(name.slice('text:'.length), 'text');
      if (name.startsWith('structure:')) return derivativeRenderer(name.slice('structure:'.length), 'structure');
      if (name.startsWith('tool:')) {
        const [, kind, referenceId] = name.split(':');
        return toolRenderer(kind as ToolKind, referenceId || undefined);
      }
      return toolRenderer('analysis');
    },
  });

  const addPanel = (id: string, component: string, title: string, direction: 'right' | 'below' | 'within' = 'right') => {
    const existing = api.getPanel(id);
    if (existing) { existing.api.setActive(); return; }
    const referencePanel = api.activePanel || api.panels[api.panels.length - 1];
    api.addPanel({ id, component, title, position: referencePanel ? { referencePanel, direction } : undefined });
  };

  const controller = {
    openCatalog() { addPanel('catalog', 'catalog', 'Catalog', 'within'); },
    openDocument(referenceId: string) { activeReference = referenceId; const ref = references.get(referenceId); if (ref) addPanel(`document-${referenceId}`, `document:${referenceId}`, ref.title, 'right'); },
    openDerivative(referenceId: string, kind: 'text' | 'structure') { const ref = references.get(referenceId); addPanel(`${kind}-${referenceId}`, `${kind}:${referenceId}`, `${kind === 'text' ? 'Text' : 'Structure'} · ${ref?.title || ''}`, 'right'); },
    openTool(kind: ToolKind, referenceId = activeReference || undefined) { const suffix = referenceId || 'global'; addPanel(`tool-${kind}-${suffix}`, `tool:${kind}:${referenceId || ''}`, kind === 'agent' ? 'AI agent' : kind[0].toUpperCase() + kind.slice(1), 'right'); },
  };

  const resize = new ResizeObserver(([entry]) => api.layout(entry.contentRect.width, entry.contentRect.height));
  resize.observe(host);
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try { api.fromJSON(JSON.parse(saved)); }
    catch { api.clear(); controller.openCatalog(); }
  } else controller.openCatalog();
  api.onDidLayoutChange(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(api.toJSON()));
  });

  const renderTree = (query = '') => {
    tree.replaceChildren();
    const makeButton = (label: string, count: number, libraryId: string | null) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tree-node';
      button.classList.toggle('active', activeLibrary === libraryId); button.dataset.libraryId = libraryId || '';
      const text = document.createElement('span'); text.textContent = label; const badge = document.createElement('b'); badge.textContent = String(count);
      button.append(text, badge); button.addEventListener('click', () => { activeLibrary = libraryId; refreshTable(); renderTree(search.value); controller.openCatalog(); });
      return button;
    };
    const matched = payload.references.filter((reference) => !query || [reference.title, reference.authors, reference.citeKey].some((value) => normalize(value).includes(normalize(query))));
    tree.appendChild(makeButton('All references', matched.length, null));
    const children = (parentId?: string) => payload.libraries.filter((library) => (library.parentId || undefined) === parentId);
    const appendLibrary = (library: LibraryNode, container: HTMLElement) => {
      const details = document.createElement('details'); details.open = true; details.className = 'tree-branch';
      const summary = document.createElement('summary');
      const own = matched.filter((reference) => reference.libraryIds.includes(library.id));
      summary.appendChild(makeButton(library.name, own.length, library.id)); details.appendChild(summary);
      summary.addEventListener('dragover', (event) => { event.preventDefault(); summary.classList.add('drop-target'); });
      summary.addEventListener('dragleave', () => summary.classList.remove('drop-target'));
      summary.addEventListener('drop', async (event) => {
        event.preventDefault(); summary.classList.remove('drop-target');
        const referenceId = event.dataTransfer?.getData('application/x-seshat-reference') || '';
        const reference = references.get(referenceId);
        if (!reference || reference.libraryIds.includes(library.id)) return;
        const response = await fetch(`/api/library/${referenceId}/libraries`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ libraryId: library.id }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { setSaveState(result.error || 'Could not add to library', 'error'); return; }
        reference.libraryIds = result.libraryIds; library.itemCount += 1; renderTree(search.value); refreshTable(); setSaveState('added to library');
      });
      const nested = document.createElement('div'); nested.className = 'tree-children';
      children(library.id).forEach((child) => appendLibrary(child, nested));
      own.slice(0, 100).forEach((reference) => {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'tree-reference'; item.title = reference.title;
        item.draggable = true;
        const glyph = document.createElement('span'); glyph.textContent = reference.format === 'pdf' ? '▧' : '≡';
        const title = document.createElement('span'); title.textContent = reference.title; item.append(glyph, title);
        item.addEventListener('click', () => controller.openDocument(reference.id)); nested.appendChild(item);
        item.addEventListener('dragstart', (event) => event.dataTransfer?.setData('application/x-seshat-reference', reference.id));
      });
      details.appendChild(nested); container.appendChild(details);
    };
    children().forEach((library) => appendLibrary(library, tree));
  };

  search.addEventListener('input', () => renderTree(search.value));
  root.querySelector<HTMLButtonElement>('[data-new-library]')?.addEventListener('click', async () => {
    const name = window.prompt(activeLibrary ? 'New folder inside the selected library' : 'New library');
    if (!name?.trim()) return;
    const response = await fetch('/api/libraries', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ name, parentId: activeLibrary }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setSaveState(result.error || 'Could not create library', 'error'); return; }
    payload.libraries.push(result.library); renderTree(search.value); setSaveState('library created');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-open-tool]').forEach((button) => button.addEventListener('click', () => controller.openTool(button.dataset.openTool as ToolKind)));
  renderTree();
}
