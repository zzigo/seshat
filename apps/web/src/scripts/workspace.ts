import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview-core';

registerAllModules();

type ReferenceRow = {
  id: string; citeKey: string; type: string; title: string; authors: string; year: number | string;
  isbn: string; language: string; tags: string; abstract: string; format: string; filename: string;
  libraryIds: string[]; status: string; hasStructure: boolean; hasText: boolean; access: 'owner' | 'viewer';
};
type LibraryNode = { id: string; name: string; description?: string; parentId?: string; itemCount: number; access: 'owner' | 'viewer'; sharedByEmail?: string };
type WorkspacePayload = { references: ReferenceRow[]; libraries: LibraryNode[] };
type ToolKind = 'analysis' | 'annotation' | 'agent';
type Activity = { id: string; message: string; state: 'working' | 'complete' | 'error'; referenceId?: string; mapReady?: boolean };

const STORAGE_KEY = 'seshat.workspace.layout.v1';
const readPayload = (): WorkspacePayload => JSON.parse(document.getElementById('seshat-workspace-data')?.textContent || '{"references":[],"libraries":[]}');
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
const rowFromCatalogReference = (reference: any): ReferenceRow => ({
  id: reference.id,
  citeKey: reference.citeKey,
  type: reference.type,
  title: reference.title,
  authors: (reference.contributors || []).map((contributor:any) => contributor.literal
    || [contributor.family, contributor.given].filter(Boolean).join(', ')).filter(Boolean).join('; '),
  year: reference.issued?.year || '',
  isbn: (reference.identifiers?.isbn || []).join('; '),
  language: reference.language || '',
  tags: (reference.tags || []).join(', '),
  abstract: reference.abstract || '',
  format: String(reference.source?.originalFilename || '').split('.').pop()?.toLowerCase() || 'document',
  filename: String(reference.source?.originalFilename || reference.title),
  libraryIds: reference.libraryIds || [],
  status: (reference.jobs || []).find((job:any) => job.status === 'running' || job.status === 'queued')?.stage
    || (reference.jobs || []).find((job:any) => job.status === 'failed')?.status || 'catalogued',
  hasStructure: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'structure'),
  hasText: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'markdown'),
  access: reference.access || 'owner',
});

export function mountSeshatWorkspace(root: HTMLElement): void {
  const payload = readPayload();
  const references = new Map(payload.references.map((reference) => [reference.id, reference]));
  const host = root.querySelector<HTMLElement>('[data-dockview-host]');
  const tree = root.querySelector<HTMLElement>('[data-library-tree]');
  const search = root.querySelector<HTMLInputElement>('[data-tree-search]');
  const saveState = root.querySelector<HTMLElement>('[data-save-state]');
  const consoleRoot = root.querySelector<HTMLElement>('[data-workspace-console]');
  const consoleCurrent = root.querySelector<HTMLElement>('[data-console-current]');
  const consoleCount = root.querySelector<HTMLElement>('[data-console-count]');
  const consoleDrawer = root.querySelector<HTMLElement>('[data-console-drawer]');
  const consoleLog = root.querySelector<HTMLOListElement>('[data-console-log]');
  const consoleToggle = root.querySelector<HTMLButtonElement>('[data-console-toggle]');
  if (!host || !tree || !search || !saveState || !consoleRoot || !consoleCurrent || !consoleCount || !consoleDrawer || !consoleLog || !consoleToggle) return;

  let api: DockviewApi;
  let catalogTable: Handsontable | null = null;
  let activeLibrary: string | null = null;
  let activeReference: string | null = payload.references[0]?.id || null;
  const committed = new Map(payload.references.map((reference) => [reference.id, { ...reference }]));
  const saveTimers = new Map<string, number>();
  const activities: Activity[] = [];
  const bibliographyFiles = new Map<string, File[]>();

  const filteredRows = () => payload.references.filter((reference) => !activeLibrary || reference.libraryIds.includes(activeLibrary));
  const refreshTable = () => catalogTable?.loadData(filteredRows());

  const setSaveState = (state: string, tone: 'ready' | 'saving' | 'error' = 'ready') => {
    saveState.textContent = state;
    saveState.dataset.tone = tone;
  };

  const renderActivities = () => {
    const active = activities.filter((activity) => activity.state === 'working');
    const latest = activities[activities.length - 1];
    consoleRoot.dataset.state = active.length ? 'working' : latest?.state || 'idle';
    consoleCurrent.textContent = latest?.message || 'Ready · drop PDF, DOCX, TXT, EPUB or BIB anywhere';
    consoleCount.textContent = `${active.length} ${active.length === 1 ? 'job' : 'jobs'}`;
    consoleLog.replaceChildren();
    [...activities].reverse().slice(0, 30).forEach((activity) => {
      const item = document.createElement('li'); item.dataset.state = activity.state;
      const mark = document.createElement('span'); mark.textContent = activity.state === 'working' ? '●' : activity.state === 'complete' ? '✓' : '×';
      const message = document.createElement('span'); message.textContent = activity.message; item.append(mark, message);
      if (activity.mapReady && activity.referenceId) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Open map';
        button.addEventListener('click', () => controller.openDerivative(activity.referenceId!, 'structure')); item.appendChild(button);
      }
      consoleLog.appendChild(item);
    });
  };

  const updateActivity = (id: string, patch: Partial<Activity>) => {
    const activity = activities.find((item) => item.id === id);
    if (activity) Object.assign(activity, patch);
    else activities.push({ id, message: patch.message || 'Working…', state: patch.state || 'working', referenceId: patch.referenceId, mapReady: patch.mapReady });
    renderActivities();
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
        { data: '__delete', title: '', readOnly: true, width: 34, renderer: (instance, td, row) => {
          Handsontable.dom.empty(td);
          const reference = instance.getSourceDataAtRow(row) as ReferenceRow | undefined;
          if (reference?.access === 'viewer') { td.textContent = '·'; td.title = 'Shared reference (read only)'; return; }
          const button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-delete';
          button.textContent = '×'; button.title = 'Delete reference and stored files'; button.setAttribute('aria-label', 'Delete reference and stored files');
          td.appendChild(button);
        } },
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
      autoRowSize: false,
      columnHeaderHeight: 30,
      width: '100%',
      height: '100%',
      stretchH: 'none',
      fixedColumnsStart: 3,
      filters: true,
      dropdownMenu: true,
      multiColumnSorting: true,
      manualColumnMove: true,
      manualColumnResize: true,
      copyPaste: true,
      fillHandle: true,
      contextMenu: true,
      outsideClickDeselects: false,
      cells: (row) => filteredRows()[row]?.access === 'viewer' ? { readOnly: true } : {},
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
        if (coords.row < 0) return;
        const physicalRow = catalogTable?.toPhysicalRow(coords.row) ?? coords.row;
        const row = catalogTable?.getSourceDataAtRow(physicalRow) as ReferenceRow | undefined;
        if (!row) return;
        const property = catalogTable?.colToProp(coords.col);
        if (property === '__delete') { event.preventDefault(); void deleteReference(row.id); return; }
        if (event.detail === 2) controller.openDocument(row.id);
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

  const bibliographyRenderer = (batchId: string): IContentRenderer => {
    const element = panel('bibliography-pod');
    return { element, init() {
      const data = JSON.parse(window.sessionStorage.getItem(`seshat.bibliography.${batchId}`) || '{"entries":[],"errors":[]}');
      const header = document.createElement('header'); header.className = 'bibliography-pod-head';
      const title = document.createElement('h2'); title.textContent = `${data.entries.length} parsed references`;
      const health = document.createElement('span'); health.textContent = data.errors.length ? `${data.errors.length} issues` : 'syntax healthy';
      header.append(title, health); element.appendChild(header);
      const controls = document.createElement('div'); controls.className = 'bibliography-import-controls';
      const target = document.createElement('select'); target.setAttribute('aria-label', 'Import destination');
      const fresh = document.createElement('option'); fresh.value = ''; fresh.textContent = 'New library (default)'; target.appendChild(fresh);
      payload.libraries.forEach((library) => { const option = document.createElement('option'); option.value = library.id; option.textContent = library.name; target.appendChild(option); });
      const name = document.createElement('input'); name.type = 'text'; name.placeholder = 'New library name';
      name.value = (bibliographyFiles.get(batchId)?.[0]?.name || 'Bibliography').replace(/\.bib$/i, '');
      const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = 'Import references';
      target.addEventListener('change', () => { name.hidden = Boolean(target.value); });
      importButton.addEventListener('click', async () => {
        const files = bibliographyFiles.get(batchId) || [];
        if (!files.length) { setSaveState('Bibliography files are no longer available; drop them again.', 'error'); return; }
        importButton.disabled = true; importButton.textContent = 'Importing…';
        const form = new FormData(); files.forEach((file) => form.append('files', file, file.name));
        if (target.value) form.set('libraryId', target.value);
        else { form.set('libraryName', name.value); if (activeLibrary) form.set('parentId', activeLibrary); }
        try {
          const response = await fetch('/api/bibliography/import', { method: 'POST', body: form });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Bibliography import failed.');
          if (result.library && !payload.libraries.some((library) => library.id === result.library.id)) payload.libraries.push(result.library);
          (result.references || []).forEach((reference: any) => upsertRow(rowFromCatalogReference(reference)));
          bibliographyFiles.delete(batchId);
          health.textContent = `${result.imported} imported · ${result.errors?.length || 0} issues`;
          importButton.textContent = 'Imported'; setSaveState('bibliography imported'); renderTree(search.value);
        } catch (error) {
          importButton.disabled = false; importButton.textContent = 'Import references';
          setSaveState(error instanceof Error ? error.message : 'Bibliography import failed', 'error');
        }
      });
      controls.append(target, name, importButton); element.appendChild(controls);
      const list = document.createElement('div'); list.className = 'bibliography-pod-list';
      for (const entry of data.entries) {
        const row = document.createElement('article');
        const kind = document.createElement('span'); kind.textContent = entry.type || 'entry';
        const copy = document.createElement('div');
        const heading = document.createElement('strong'); heading.textContent = entry.fields?.title || 'Untitled reference';
        const author = document.createElement('small');
        author.textContent = (entry.fields?.author || []).map((person:any) => [person.lastName, person.firstName].filter(Boolean).join(', ')).join(' · ') || 'Author missing';
        copy.append(heading, author);
        const key = document.createElement('code'); key.textContent = `@${entry.key || 'missing-key'}`;
        row.append(kind, copy, key); list.appendChild(row);
      }
      element.appendChild(list);
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
      if (name.startsWith('bibliography:')) return bibliographyRenderer(name.slice('bibliography:'.length));
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
    openBibliography(batchId: string, title = 'Bibliography') { addPanel(`bibliography-${batchId}`, `bibliography:${batchId}`, title, 'right'); },
  };

  const deleteReference = async (referenceId: string) => {
    const reference = references.get(referenceId);
    if (!reference) return;
    const timer = saveTimers.get(referenceId);
    if (timer) window.clearTimeout(timer);
    saveTimers.delete(referenceId);
    const activityId = `delete-${referenceId}`;
    updateActivity(activityId, { state: 'working', message: `${reference.title} · deleting catalog entry and R2 files` });
    setSaveState('deleting…', 'saving');
    try {
      const response = await fetch(`/api/library/${referenceId}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Delete failed');
      api.panels.filter((item) => item.id.includes(referenceId)).forEach((item) => item.api.close());
      references.delete(referenceId);
      committed.delete(referenceId);
      const index = payload.references.findIndex((item) => item.id === referenceId);
      if (index >= 0) payload.references.splice(index, 1);
      if (activeReference === referenceId) activeReference = null;
      refreshTable();
      renderTree(search.value);
      updateActivity(activityId, { state: 'complete', message: `${reference.title} · deleted from catalog and R2` });
      setSaveState('deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      updateActivity(activityId, { state: 'error', message: `${reference.title} · ${message}` });
      setSaveState(message, 'error');
    }
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
    const moveReference = async (reference: ReferenceRow, libraryIds: string[]) => {
      const response = await fetch(`/api/library/${reference.id}/libraries`, { method: 'PUT', headers: {'content-type':'application/json'}, body: JSON.stringify({ libraryIds }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not move reference.');
      reference.libraryIds = result.libraryIds; renderTree(search.value); refreshTable();
    };
    const moveLibrary = async (library: LibraryNode, parentId: string | null) => {
      const response = await fetch(`/api/libraries/${library.id}`, { method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({ parentId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not move library.');
      library.parentId = result.library.parentId; renderTree(search.value);
    };
    const allButton = makeButton('All references', matched.length, null);
    allButton.addEventListener('dragover', (event) => { event.preventDefault(); allButton.classList.add('drop-target'); });
    allButton.addEventListener('dragleave', () => allButton.classList.remove('drop-target'));
    allButton.addEventListener('drop', async (event) => {
      event.preventDefault(); allButton.classList.remove('drop-target');
      const reference = references.get(event.dataTransfer?.getData('application/x-seshat-reference') || '');
      const library = payload.libraries.find((item) => item.id === event.dataTransfer?.getData('application/x-seshat-library'));
      try {
        if (reference) { await moveReference(reference, []); setSaveState('moved outside libraries'); }
        else if (library) { await moveLibrary(library, null); setSaveState('library moved to root'); }
      } catch (error) { setSaveState(error instanceof Error ? error.message : 'Move failed', 'error'); }
    });
    tree.appendChild(allButton);
    const children = (parentId?: string) => payload.libraries.filter((library) => (library.parentId || undefined) === parentId);
    const appendLibrary = (library: LibraryNode, container: HTMLElement) => {
      const details = document.createElement('details'); details.open = true; details.className = 'tree-branch';
      const summary = document.createElement('summary'); summary.draggable = !library.id.startsWith('inbox:');
      const own = matched.filter((reference) => reference.libraryIds.includes(library.id));
      const libraryRow = document.createElement('div'); libraryRow.className = 'tree-library-row';
      libraryRow.appendChild(makeButton(library.name, own.length, library.id));
      if (!library.id.startsWith('inbox:') && library.access !== 'viewer') {
        const actions = document.createElement('span'); actions.className = 'tree-library-actions';
        const share = document.createElement('button'); share.type = 'button'; share.textContent = '↗'; share.title = 'Share library with a Musiki user';
        share.addEventListener('click', async (event) => {
          event.preventDefault(); event.stopPropagation();
          const email = window.prompt(`Share “${library.name}” with which Musiki user?`, '')?.trim().toLowerCase();
          if (!email) return;
          const response = await fetch(`/api/libraries/${library.id}/shares`, {
            method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ email }),
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) { setSaveState(result.error || 'Share failed', 'error'); return; }
          setSaveState(`shared with ${email}`);
        });
        const rename = document.createElement('button'); rename.type = 'button'; rename.textContent = '✎'; rename.title = 'Rename library';
        rename.addEventListener('click', async (event) => {
          event.preventDefault(); event.stopPropagation(); const next = window.prompt('Rename library', library.name)?.trim(); if (!next || next === library.name) return;
          const response = await fetch(`/api/libraries/${library.id}`, { method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({ name: next }) });
          const result = await response.json().catch(() => ({})); if (!response.ok) { setSaveState(result.error || 'Rename failed', 'error'); return; }
          library.name = result.library.name; renderTree(search.value); setSaveState('library renamed');
        });
        const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Delete library or folder';
        remove.addEventListener('click', async (event) => {
          event.preventDefault(); event.stopPropagation();
          if (!window.confirm(`Delete “${library.name}” and its subfolders? References will remain in the catalog.`)) return;
          const response = await fetch(`/api/libraries/${library.id}`, { method: 'DELETE' }); const result = await response.json().catch(() => ({}));
          if (!response.ok) { setSaveState(result.error || 'Delete failed', 'error'); return; }
          const removeIds = new Set<string>([library.id]); let changed = true;
          while (changed) { changed = false; payload.libraries.forEach((item) => { if (item.parentId && removeIds.has(item.parentId) && !removeIds.has(item.id)) { removeIds.add(item.id); changed = true; } }); }
          payload.libraries = payload.libraries.filter((item) => !removeIds.has(item.id)); payload.references.forEach((item) => { item.libraryIds = item.libraryIds.filter((id) => !removeIds.has(id)); });
          if (activeLibrary && removeIds.has(activeLibrary)) activeLibrary = null; renderTree(search.value); refreshTable(); setSaveState('library deleted');
        });
        actions.append(share, rename, remove); libraryRow.appendChild(actions);
      } else if (library.access === 'viewer') {
        const shared = document.createElement('span'); shared.className = 'tree-shared';
        shared.textContent = 'shared'; shared.title = library.sharedByEmail ? `Shared by ${library.sharedByEmail}` : 'Shared library';
        libraryRow.appendChild(shared);
      }
      summary.appendChild(libraryRow); details.appendChild(summary);
      summary.addEventListener('dragstart', (event) => {
        if (library.access === 'viewer') { event.preventDefault(); return; }
        event.dataTransfer?.setData('application/x-seshat-library', library.id); event.stopPropagation();
      });
      summary.addEventListener('dragover', (event) => { event.preventDefault(); summary.classList.add('drop-target'); });
      summary.addEventListener('dragleave', () => summary.classList.remove('drop-target'));
      summary.addEventListener('drop', async (event) => {
        event.preventDefault(); summary.classList.remove('drop-target');
        const draggedLibrary = payload.libraries.find((item) => item.id === event.dataTransfer?.getData('application/x-seshat-library'));
        if (draggedLibrary) {
          try { await moveLibrary(draggedLibrary, library.id); setSaveState('library moved'); }
          catch (error) { setSaveState(error instanceof Error ? error.message : 'Move failed', 'error'); }
          return;
        }
        const referenceId = event.dataTransfer?.getData('application/x-seshat-reference') || '';
        const reference = references.get(referenceId);
        if (!reference) return;
        try {
          const next = event.altKey ? [...new Set([...reference.libraryIds, library.id])] : [library.id];
          await moveReference(reference, next); setSaveState(event.altKey ? 'added to library' : 'reference moved');
        } catch (error) { setSaveState(error instanceof Error ? error.message : 'Move failed', 'error'); }
      });
      const nested = document.createElement('div'); nested.className = 'tree-children';
      children(library.id).forEach((child) => appendLibrary(child, nested));
      own.slice(0, 100).forEach((reference) => {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'tree-reference'; item.title = reference.title;
        item.draggable = reference.access !== 'viewer';
        const glyph = document.createElement('span'); glyph.textContent = reference.format === 'pdf' ? '▧' : '≡';
        const title = document.createElement('span'); title.textContent = reference.title; item.append(glyph, title);
        item.addEventListener('click', () => controller.openDocument(reference.id)); nested.appendChild(item);
        item.addEventListener('dragstart', (event) => event.dataTransfer?.setData('application/x-seshat-reference', reference.id));
      });
      details.appendChild(nested); container.appendChild(details);
    };
    children().forEach((library) => appendLibrary(library, tree));
  };

  const upsertRow = (next: ReferenceRow) => {
    const current = references.get(next.id);
    if (current) Object.assign(current, next);
    else { payload.references.unshift(next); references.set(next.id, next); }
    committed.set(next.id, { ...(references.get(next.id) as ReferenceRow) });
    refreshTable();
    renderTree(search.value);
  };

  const wait = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const stageMessage: Record<string, string> = {
    extract: 'Extracting text and structure',
    identify: 'Identifying title, author and year',
    summarize: 'Preparing summary',
    relate: 'Relating document to the corpus',
  };

  const followPipeline = async (referenceId: string, activityId: string, filename: string) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const response = await fetch(`/api/library/${referenceId}/status`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not read processing state.');
      const status = await response.json();
      upsertRow(status.reference as ReferenceRow);
      if (status.failed) {
        updateActivity(activityId, { state: 'error', message: `${filename} · ${status.failed}` });
        return;
      }
      if (status.ready) {
        updateActivity(activityId, { state: 'complete', message: `${status.reference.title} · text and structure ready`, referenceId, mapReady: status.reference.hasStructure });
        return;
      }
      const active = status.pipeline.find((job:any) => job.status === 'running' || job.status === 'queued');
      updateActivity(activityId, { message: `${filename} · ${stageMessage[active?.stage] || 'Waiting for worker'}`, referenceId });
      await wait(4000);
    }
    updateActivity(activityId, { state: 'error', message: `${filename} · processing timed out` });
  };

  const ingestDocument = async (file: File) => {
    const activityId = `document-${crypto.randomUUID()}`;
    updateActivity(activityId, { state: 'working', message: `${file.name} · uploading` });
    const form = new FormData(); form.set('file', file, file.name);
    if (activeLibrary) form.set('libraryId', activeLibrary);
    try {
      const response = await fetch('/api/intake/documents', { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Upload failed.');
      const row = rowFromCatalogReference(result.reference);
      upsertRow(row);
      updateActivity(activityId, { message: `${file.name} · ${result.duplicate ? 'already catalogued' : 'Extracting text and structure'}`, referenceId: row.id });
      void followPipeline(row.id, activityId, file.name).catch((error) => {
        updateActivity(activityId, { state: 'error', message: `${file.name} · ${error instanceof Error ? error.message : 'status unavailable'}` });
      });
    } catch (error) {
      updateActivity(activityId, { state: 'error', message: `${file.name} · ${error instanceof Error ? error.message : 'upload failed'}` });
    }
  };

  const inspectBibliography = async (files: File[]) => {
    const activityId = `bibliography-${crypto.randomUUID()}`;
    updateActivity(activityId, { state: 'working', message: `${files.length} bibliography file${files.length === 1 ? '' : 's'} · parsing` });
    const form = new FormData(); files.forEach((file) => form.append('files', file, file.name));
    try {
      const response = await fetch('/api/bibliography/parse', { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not parse bibliography.');
      bibliographyFiles.set(activityId, files);
      window.sessionStorage.setItem(`seshat.bibliography.${activityId}`, JSON.stringify(result));
      controller.openBibliography(activityId, files.length === 1 ? files[0].name : 'Bibliography import');
      updateActivity(activityId, { state: 'complete', message: `${result.entries.length} references parsed · opened as pod` });
    } catch (error) {
      updateActivity(activityId, { state: 'error', message: error instanceof Error ? error.message : 'Bibliography parse failed' });
    }
  };

  window.addEventListener('seshat:workspace-drop', (event) => {
    const detail = (event as CustomEvent<{ files: File[]; rejected: number }>).detail;
    const bibliographies = detail.files.filter((file) => file.name.toLowerCase().endsWith('.bib'));
    const documents = detail.files.filter((file) => !file.name.toLowerCase().endsWith('.bib'));
    if (detail.rejected) updateActivity(`rejected-${Date.now()}`, { state: 'error', message: `${detail.rejected} unsupported file${detail.rejected === 1 ? '' : 's'} omitted` });
    if (bibliographies.length) void inspectBibliography(bibliographies);
    void (async () => {
      for (const file of documents) await ingestDocument(file);
    })();
  });

  consoleToggle.addEventListener('click', () => {
    const expanded = consoleDrawer.hidden;
    consoleDrawer.hidden = !expanded;
    consoleToggle.setAttribute('aria-expanded', String(expanded));
  });

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
