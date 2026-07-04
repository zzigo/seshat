import Handsontable from 'handsontable';
import { registerAllModules } from 'handsontable/registry';
import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview-core';
import { CONTRIBUTOR_ROLES, contributorSummary, normalizeContributor, normalizeContributors, type Contributor } from '@seshat/core';
import { mountAnnotationWorkspace } from './annotations';
import { mountPdfViewer } from './pdf-viewer';
import { referenceFileType } from '../lib/reference-file';

registerAllModules();

type ReferenceRow = {
  id: string; citeKey: string; type: string; title: string; contributors: Contributor[]; contributorsDisplay: string; year: number | string;
  isbn: string; language: string; tags: string; abstract: string; format: string; fileType: string; filename: string;
  publisher: string; publisherPlace: string; url: string;
  libraryIds: string[]; status: string; hasStructure: boolean; hasText: boolean; access: 'owner' | 'viewer';
};
type LibraryNode = { id: string; name: string; description?: string; parentId?: string; itemCount: number; access: 'owner' | 'viewer'; sharedByEmail?: string };
type WorkspacePayload = { references: ReferenceRow[]; libraries: LibraryNode[] };
type ShareTarget = { id: string; type: 'user' | 'group'; label: string; email?: string; emails?: string[]; memberCount?: number };
type ToolKind = 'analysis' | 'annotation' | 'agent' | 'graph' | 'search';
type Activity = { id: string; message: string; state: 'working' | 'complete' | 'error'; referenceId?: string; mapReady?: boolean };

const STORAGE_KEY = 'seshat.workspace.layout.v1';
const TREE_STATE_KEY = 'seshat.workspace.tree.v1';
const readPayload = (): WorkspacePayload => JSON.parse(document.getElementById('seshat-workspace-data')?.textContent || '{"references":[],"libraries":[]}');
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
const rowFromCatalogReference = (reference: any): ReferenceRow => ({
  id: reference.id,
  citeKey: reference.citeKey,
  type: reference.type,
  title: reference.title,
  contributors: normalizeContributors(reference.contributors || []),
  contributorsDisplay: contributorSummary(reference.contributors || []),
  year: reference.issued?.year || '',
  isbn: (reference.identifiers?.isbn || []).join('; '),
  language: reference.language || '',
  tags: (reference.tags || []).join(', '),
  abstract: reference.abstract || '',
  publisher: reference.publisher || '',
  publisherPlace: reference.publisherPlace || '',
  url: reference.url || '',
  format: referenceFileType(reference),
  fileType: referenceFileType(reference).toUpperCase() || '—',
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
  let previewRender: ((referenceId: string) => void) | null = null;
  const documentDisposers = new WeakMap<HTMLElement, () => void>();
  const selectedReferences = new Set<string>();
  const committed = new Map(payload.references.map((reference) => [reference.id, { ...reference }]));
  const saveTimers = new Map<string, number>();
  const activities: Activity[] = [];
  const bibliographyFiles = new Map<string, File[]>();
  const collapsedLibraries = new Set<string>(JSON.parse(window.localStorage.getItem(TREE_STATE_KEY) || '[]'));

  const filteredRows = () => payload.references.filter((reference) => !activeLibrary || reference.libraryIds.includes(activeLibrary));
  const refreshTable = () => catalogTable?.loadData(filteredRows());

  const setSaveState = (state: string, tone: 'ready' | 'saving' | 'error' = 'ready') => {
    saveState.textContent = state;
    saveState.dataset.tone = tone;
  };

  const dialogShell = (title: string) => {
    const dialog = document.createElement('dialog'); dialog.className = 'seshat-dialog';
    const header = document.createElement('header');
    const heading = document.createElement('h2'); heading.textContent = title;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => dialog.close()); header.append(heading, close); dialog.appendChild(header);
    dialog.addEventListener('close', () => dialog.remove()); root.appendChild(dialog); dialog.showModal();
    return dialog;
  };

  const requestText = (title: string, labelText: string, value = '', submitLabel = 'Save'): Promise<string | null> => new Promise((resolve) => {
    const dialog = dialogShell(title); const form = document.createElement('form'); form.className = 'dialog-form';
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.type = 'text'; input.value = value; input.autocomplete = 'off'; label.appendChild(input);
    const actions = document.createElement('footer');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'primary'; submit.textContent = submitLabel;
    actions.append(cancel, submit); form.append(label, actions); dialog.appendChild(form);
    let settled = false; const finish = (result: string | null) => { if (settled) return; settled = true; resolve(result); dialog.close(); };
    cancel.addEventListener('click', () => finish(null)); dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    dialog.addEventListener('close', () => { if (!settled) { settled = true; resolve(null); } });
    form.addEventListener('submit', (event) => { event.preventDefault(); const result = input.value.trim(); if (result) finish(result); else input.focus(); });
    window.requestAnimationFrame(() => { input.focus(); input.select(); });
  });

  const confirmAction = (title: string, message: string, confirmLabel: string): Promise<boolean> => new Promise((resolve) => {
    const dialog = dialogShell(title); const body = document.createElement('div'); body.className = 'dialog-confirm';
    const copy = document.createElement('p'); copy.textContent = message;
    const actions = document.createElement('footer');
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'danger'; confirm.textContent = confirmLabel;
    actions.append(cancel, confirm); body.append(copy, actions); dialog.appendChild(body);
    let settled = false; const finish = (result: boolean) => { if (settled) return; settled = true; resolve(result); dialog.close(); };
    cancel.addEventListener('click', () => finish(false)); confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener('close', () => { if (!settled) { settled = true; resolve(false); } });
  });

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
    form.set('contributors', JSON.stringify(row.contributors));
    form.set('year', String(row.year || ''));
    form.set('isbns', row.isbn);
    form.set('citeKey', row.citeKey);
    form.set('type', row.type);
    form.set('language', row.language);
    form.set('tags', row.tags);
    form.set('abstract', row.abstract);
    form.set('publisher', row.publisher);
    form.set('publisherPlace', row.publisherPlace);
    form.set('url', row.url);
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

  const selectedIds = () => [...selectedReferences].filter((id) => references.has(id));
  const bibtexEscape = (value: unknown) => String(value ?? '').replace(/[{}]/g, '').trim();
  const bibtexType = (type: string) => ({
    'article-journal': 'article', article: 'article', chapter: 'incollection',
    'paper-conference': 'inproceedings', thesis: 'phdthesis', report: 'techreport', book: 'book',
  }[type] || 'misc');
  const toBetterBibtex = (rows: ReferenceRow[]) => rows.map((row) => {
    const byRole = (role: Contributor['role']) => row.contributors.filter((person) => person.role === role)
      .map((person) => person.literal || [person.family, person.given].filter(Boolean).join(', ')).filter(Boolean).join(' and ');
    const fields: Array<[string, string]> = [
      ['title', row.title],
      ['author', byRole('author')],
      ['editor', byRole('editor')],
      ['translator', byRole('translator')],
      ['composer', byRole('composer')],
      ['year', String(row.year || '')],
      ['publisher', row.publisher],
      ['address', row.publisherPlace],
      ['isbn', row.isbn],
      ['url', row.url],
      ['language', row.language],
      ['abstract', row.abstract],
      ['keywords', row.tags],
    ].filter((field): field is [string, string] => Boolean(field[1]?.trim()));
    const body = fields.map(([key, value]) => `  ${key} = {${bibtexEscape(value)}}`).join(',\n');
    return `@${bibtexType(row.type)}{${row.citeKey || row.id},\n${body}\n}`;
  }).join('\n\n');
  const apaContributor = (person: Contributor) => {
    if (person.literal) return person.literal;
    const initials = String(person.given || '').split(/\s+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase()}.`).join(' ');
    return [person.family, initials].filter(Boolean).join(', ');
  };
  const toApa = (row: ReferenceRow) => {
    const primary = row.contributors.filter((person) => person.role === 'author');
    const people = (primary.length ? primary : row.contributors.filter((person) => person.role === 'editor')).map(apaContributor).filter(Boolean);
    const author = people.length > 1 ? `${people.slice(0, -1).join(', ')}, & ${people.at(-1)}` : people[0] || 'Unknown author';
    return `${author} (${row.year || 'n.d.'}). ${row.title}.${row.publisher ? ` ${row.publisher}.` : ''}${row.url ? ` ${row.url}` : ''}`;
  };
  const copyText = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); setSaveState(`${label} copied`); }
    catch { setSaveState('Clipboard access was denied', 'error'); }
  };
  const copyReferences = (ids: string[], format: 'apa' | 'bibtex') => {
    const rows = ids.map((id) => references.get(id)).filter((row): row is ReferenceRow => Boolean(row));
    if (!rows.length) { setSaveState('no references selected', 'error'); return; }
    void copyText(format === 'apa' ? rows.map(toApa).join('\n') : toBetterBibtex(rows), format === 'apa' ? 'APA citation' : 'Better BibTeX');
  };
  const pickAssociatedFile = (referenceId: string) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.pdf,.docx,.txt,.epub';
    input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void replaceAssociatedFile(referenceId, file); });
    input.click();
  };
  const runReferenceAction = async (ids: string[], action: 'reprocess-metadata' | 'summarize' | 'extract' | 'relate') => {
    let label = 'AI summary';
    let message = 'Preparing AI summary';
    if (action === 'reprocess-metadata') { label = 'metadata re-processing'; message = 'Identifying title, author, year and publisher'; }
    else if (action === 'extract') { label = 'text extraction'; message = 'Extracting text and document structure'; }
    else if (action === 'relate') { label = 'entity relation extraction'; message = 'Extracting entity relations graph'; }

    if (!ids.length) { setSaveState('no editable references selected', 'error'); return; }
    setSaveState(`queueing ${label}…`, 'saving');
    const response = await fetch('/api/library/actions', {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ ids, action }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setSaveState(result.error || `Could not queue ${label}`, 'error'); return; }
    setSaveState(`${result.queued} ${result.queued === 1 ? 'item' : 'items'} queued for ${label}`);
    for (const id of ids) {
      updateActivity(`${action}-${id}`, { state: 'working', referenceId: id, message: `${references.get(id)?.title || id} · ${message}` });
      const reference = references.get(id);
      void followPipeline(id, `${action}-${id}`, reference?.filename || reference?.title || id).catch((error) => {
        updateActivity(`${action}-${id}`, { state: 'error', message: `${reference?.title || id} · ${error instanceof Error ? error.message : 'status unavailable'}` });
      });
    }
  };
  const deleteReferences = async (ids: string[]) => {
    for (const id of ids) await deleteReference(id);
    selectedReferences.clear();
    renderTree(search.value);
  };
  const referenceMenuItems = (ids: string[]) => {
    const editableIds = ids.filter((id) => references.get(id)?.access !== 'viewer');
    return [
    { label: 'Edit contributors…', disabled: editableIds.length !== 1 || ids.length !== 1, action: () => { const row = references.get(editableIds[0]); if (row) openContributorEditor(row); } },
    { label: `Copy APA citation${ids.length > 1 ? `s (${ids.length})` : ''}  Alt+Shift+A`, action: () => copyReferences(ids, 'apa') },
    { label: `Copy Better BibTeX${ids.length > 1 ? ` (${ids.length})` : ''}  Alt+Shift+B`, action: () => copyReferences(ids, 'bibtex') },
    { label: 'Upload associated file…', disabled: editableIds.length !== 1 || ids.length !== 1, action: () => pickAssociatedFile(editableIds[0]) },
    { label: `Extract text & structure${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'extract') },
    { label: `Re-process metadata${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'reprocess-metadata') },
    { label: `AI summarize${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'summarize') },
    { label: `Extract entities & relationships${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'relate') },
    { label: `Delete selected${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, danger: true, action: () => deleteReferences(editableIds) },
    ];
  };

  const openContributorEditor = (row: ReferenceRow) => {
    type DraftContributor = { role: Contributor['role']; family: string; given: string; literal: string };
    let draft: DraftContributor[] = row.contributors.map((person) => ({
      role: person.role || 'author', family: person.family || '', given: person.given || '', literal: person.literal || '',
    }));
    if (!draft.length) draft.push({ role: 'author', family: '', given: '', literal: '' });
    const dialog = dialogShell(`Contributors · ${row.title}`); dialog.classList.add('contributor-dialog');
    const editor = document.createElement('form'); editor.className = 'contributor-editor';
    const guidance = document.createElement('p'); guidance.className = 'contributor-guidance';
    guidance.textContent = 'Keep people structured as family + given. Use Literal for institutions or names that must not be parsed.';
    const list = document.createElement('div'); list.className = 'contributor-list';
    let dragged = -1;
    const render = () => {
      list.replaceChildren();
      draft.forEach((person, index) => {
        const item = document.createElement('div'); item.className = 'contributor-row';
        item.addEventListener('dragstart', () => { dragged = index; item.classList.add('dragging'); });
        item.addEventListener('dragend', () => { dragged = -1; item.classList.remove('dragging'); });
        item.addEventListener('dragover', (event) => event.preventDefault());
        item.addEventListener('drop', (event) => {
          event.preventDefault(); if (dragged < 0 || dragged === index) return;
          const [moved] = draft.splice(dragged, 1); draft.splice(index, 0, moved); render();
        });
        const handle = document.createElement('span'); handle.className = 'contributor-handle'; handle.textContent = '⋮⋮'; handle.title = 'Drag to reorder'; handle.draggable = true;
        const role = document.createElement('select'); role.setAttribute('aria-label', `Role ${index + 1}`);
        CONTRIBUTOR_ROLES.forEach((value) => { const option = document.createElement('option'); option.value = value; option.textContent = value; option.selected = value === person.role; role.appendChild(option); });
        role.addEventListener('change', () => { person.role = role.value as Contributor['role']; });
        const family = document.createElement('input'); family.placeholder = 'Family'; family.value = person.family; family.setAttribute('aria-label', `Family name ${index + 1}`);
        const given = document.createElement('input'); given.placeholder = 'Given'; given.value = person.given; given.setAttribute('aria-label', `Given name ${index + 1}`);
        const literal = document.createElement('input'); literal.placeholder = 'Institution / literal'; literal.value = person.literal; literal.setAttribute('aria-label', `Literal name ${index + 1}`);
        const syncMode = () => { item.classList.toggle('is-literal', Boolean(literal.value.trim())); };
        family.addEventListener('input', () => { person.family = family.value; }); given.addEventListener('input', () => { person.given = given.value; });
        literal.addEventListener('input', () => { person.literal = literal.value; syncMode(); }); syncMode();
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'contributor-remove'; remove.textContent = '×'; remove.title = 'Remove contributor';
        remove.addEventListener('click', () => { draft.splice(index, 1); render(); });
        item.append(handle, role, family, given, literal, remove); list.appendChild(item);
      });
    };
    render();
    const pasteDetails = document.createElement('details'); pasteDetails.className = 'contributor-paste';
    const pasteSummary = document.createElement('summary'); pasteSummary.textContent = 'Paste multiple names';
    const pasteArea = document.createElement('textarea'); pasteArea.rows = 4; pasteArea.placeholder = 'One per line, preferably: Family, Given';
    const pasteButton = document.createElement('button'); pasteButton.type = 'button'; pasteButton.textContent = 'Add pasted names';
    pasteButton.addEventListener('click', () => {
      const parsed = pasteArea.value.split(/[\n;]+/).map((value) => normalizeContributor(value)).filter((value): value is Contributor => Boolean(value));
      draft.push(...parsed.map((person) => ({ role: person.role, family: person.family || '', given: person.given || '', literal: person.literal || '' })));
      pasteArea.value = ''; pasteDetails.open = false; render();
    });
    pasteDetails.append(pasteSummary, pasteArea, pasteButton);
    const footer = document.createElement('footer');
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Contributor';
    add.addEventListener('click', () => { draft.push({ role: 'author', family: '', given: '', literal: '' }); render(); list.lastElementChild?.scrollIntoView({ block: 'nearest' }); });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dialog.close());
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'Save contributors';
    footer.append(add, cancel, save); editor.append(guidance, list, pasteDetails, footer); dialog.appendChild(editor);
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      const next = normalizeContributors(draft);
      const previous = row.contributors; row.contributors = next; row.contributorsDisplay = contributorSummary(next);
      refreshTable(); renderTree(search.value); save.disabled = true; save.textContent = 'Saving…';
      try { await saveReference(row); dialog.close(); }
      catch (error) {
        row.contributors = previous; row.contributorsDisplay = contributorSummary(previous); refreshTable(); renderTree(search.value);
        save.disabled = false; save.textContent = 'Save contributors'; setSaveState(error instanceof Error ? error.message : 'Save failed', 'error');
      }
    });
  };

  const mountCatalog = (element: HTMLElement) => {
    if (catalogTable || !element.isConnected) return;
    element.classList.add('ht-theme-main');
    element.addEventListener('contextmenu', (event) => {
      const ids = selectedIds();
      if (!ids.length) return;
      openContextMenu(event, referenceMenuItems(ids));
    });
    element.addEventListener('dragover', (event) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      const cell = (event.target as HTMLElement).closest('td');
      if (cell) { event.preventDefault(); event.stopPropagation(); cell.classList.add('associated-drop-target'); }
    });
    element.addEventListener('dragleave', (event) => (event.target as HTMLElement).closest('td')?.classList.remove('associated-drop-target'));
    element.addEventListener('drop', (event) => {
      if (!event.dataTransfer?.files.length) return;
      const cell = (event.target as HTMLElement).closest('td');
      if (!cell || !catalogTable) return;
      event.preventDefault(); event.stopPropagation(); cell.classList.remove('associated-drop-target');
      const coords = catalogTable.getCoords(cell as HTMLTableCellElement);
      const physicalRow = coords ? catalogTable.toPhysicalRow(coords.row) : -1;
      const row = physicalRow >= 0 ? catalogTable.getSourceDataAtRow(physicalRow) as ReferenceRow : undefined;
      const file = event.dataTransfer.files[0];
      if (row?.access === 'owner' && file) void replaceAssociatedFile(row.id, file);
    });
    catalogTable = new Handsontable(element, {
      data: filteredRows(),
      columns: [
        { data: 'title', title: 'Title', width: 300 },
        { data: 'contributorsDisplay', title: 'Contributors', readOnly: true, className: 'contributors-cell', width: 260 },
        { data: 'year', title: 'Year', type: 'numeric', width: 72 },
        { data: 'type', title: 'Type', type: 'dropdown', source: ['document','article','article-journal','book','chapter','paper-conference','report','thesis'], width: 130 },
        { data: 'publisher', title: 'Publisher', width: 210 },
        { data: 'publisherPlace', title: 'Place', width: 140 },
        { data: 'url', title: 'URL', width: 260 },
        { data: 'isbn', title: 'ISBN', width: 150 },
        { data: 'language', title: 'Lang', width: 70 },
        { data: 'tags', title: 'Tags', width: 190 },
        { data: 'citeKey', title: 'Citekey', width: 160 },
        { data: 'abstract', title: 'Abstract', width: 320 },
        { data: 'fileType', title: 'File', readOnly: true, width: 72 },
        { data: 'status', title: 'State', readOnly: true, width: 92 },
      ],
      rowHeaders: false,
      rowHeights: 28,
      autoRowSize: false,
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
      contextMenu: false,
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
        if (event.button === 2 && !selectedReferences.has(row.id)) {
          selectedReferences.clear();
          selectedReferences.add(row.id);
          catalogTable?.selectCell(coords.row, Math.max(0, coords.col));
          renderTree(search.value);
        }
        if (event.detail === 2 && catalogTable?.colToProp(coords.col) === 'contributorsDisplay') { if (row.access !== 'viewer') openContributorEditor(row); return; }
        if (event.detail === 2) controller.openDocument(row.id, event.altKey);
      },
      afterSelectionEnd: (row, _column, row2) => {
        selectedReferences.clear();
        for (let visual = Math.min(row, row2); visual <= Math.max(row, row2); visual += 1) {
          const physical = catalogTable?.toPhysicalRow(visual) ?? visual;
          const selected = catalogTable?.getSourceDataAtRow(physical) as ReferenceRow | undefined;
          if (selected?.id) selectedReferences.add(selected.id);
        }
        renderTree(search.value); setSaveState(`${selectedReferences.size} selected`);
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
    label.textContent = `${reference.fileType} · ${reference.filename}`;
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

  const renderDocument = (element: HTMLElement, referenceId: string) => {
    documentDisposers.get(element)?.(); documentDisposers.delete(element);
    element.replaceChildren();
    const reference = references.get(referenceId);
    if (!reference) { element.textContent = 'Reference not found.'; return; }
    activeReference = referenceId;
    element.appendChild(podToolbar(reference));
    const body = document.createElement('div'); body.className = 'pod-document-body'; element.appendChild(body);
    if (reference.format === 'pdf') {
      body.classList.add('pod-pdf-body'); const renderId = crypto.randomUUID(); element.dataset.renderId = renderId;
      void mountPdfViewer(body, reference.id, reference.title, setSaveState).then((dispose) => {
        if (element.dataset.renderId !== renderId || !element.isConnected) dispose(); else documentDisposers.set(element, dispose);
      }).catch((error) => { body.textContent = error instanceof Error ? error.message : 'PDF viewer unavailable'; });
    } else void mountText(body, reference.id, 'markdown');
  };

  const documentRenderer = (referenceId: string): IContentRenderer => {
    const element = panel('document-pod');
    return { element, init() { renderDocument(element, referenceId); }, dispose() { documentDisposers.get(element)?.(); documentDisposers.delete(element); } };
  };

  const previewRenderer = (): IContentRenderer => {
    const element = panel('document-pod');
    return { element, init() { previewRender = (referenceId) => renderDocument(element, referenceId); if (activeReference) previewRender(activeReference); }, dispose() { previewRender = null; documentDisposers.get(element)?.(); documentDisposers.delete(element); } };
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
    let disposeAnnotation: () => void = () => undefined; let disposed = false;
    return { element, init() {
      const reference = referenceId ? references.get(referenceId) : undefined;
      if (kind === 'annotation' && reference) {
        element.classList.remove('future-tool-pod');
        void mountAnnotationWorkspace(element, reference.id, reference.title, setSaveState, { indexOnly: true }).then((dispose) => {
          if (disposed) dispose(); else disposeAnnotation = dispose;
        });
        return;
      }
      if (kind === 'graph') {
        element.classList.remove('future-tool-pod');
        element.classList.add('graph-tool-pod');
        element.style.display = 'flex';
        element.style.flexDirection = 'column';
        element.style.height = '100%';
        element.style.overflow = 'hidden';
        element.style.background = 'var(--paper)';

        const header = document.createElement('header');
        header.className = 'pod-heading';
        header.style.padding = '12px 16px';
        header.style.borderBottom = '1px solid var(--line)';
        header.style.display = 'flex';
        header.style.justifyContent = 'space-between';
        header.style.alignItems = 'center';

        const titleDiv = document.createElement('div');
        const titleLabel = document.createElement('div');
        titleLabel.className = 'eyebrow';
        titleLabel.textContent = reference ? 'Document Graph' : 'Global Graph';
        const titleH2 = document.createElement('h2');
        titleH2.style.margin = '4px 0 0';
        titleH2.style.fontSize = '15px';
        titleH2.style.fontFamily = 'Georgia, serif';
        titleH2.textContent = reference ? reference.title : 'All catalogued knowledge';
        titleDiv.append(titleLabel, titleH2);
        
        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '11px';
        countSpan.style.color = 'var(--muted)';
        countSpan.textContent = 'Loading graph...';
        
        header.append(titleDiv, countSpan);
        element.appendChild(header);

        const container = document.createElement('div');
        container.style.flex = '1';
        container.style.position = 'relative';
        container.style.overflow = 'hidden';
        element.appendChild(container);

        const url = referenceId ? `/api/library/${referenceId}/graph` : '/api/library/graph';
        void fetch(url).then(r => r.json()).then(data => {
          if (disposed) return;
          const nodes = (data.nodes || []) as any[];
          const edges = (data.edges || []) as any[];
          countSpan.textContent = `${nodes.length} nodes · ${edges.length} edges`;
          
          if (!nodes.length) {
            container.innerHTML = `<div class="graph-empty" style="padding:40px;text-align:center;color:var(--muted);font-family:monospace;font-size:12px;">No entities or relationships found.</div>`;
            return;
          }

          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('width', '100%');
          svg.setAttribute('height', '100%');
          svg.style.display = 'block';
          container.appendChild(svg);

          const rect = container.getBoundingClientRect();
          const width = rect.width || 600;
          const height = rect.height || 400;
          svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

          const simNodes = nodes.map((n: any) => ({
            ...n,
            x: width / 2 + (Math.random() - 0.5) * 150,
            y: height / 2 + (Math.random() - 0.5) * 150,
            vx: 0,
            vy: 0
          }));

          const nodeMap = new Map(simNodes.map((n: any) => [n.id, n]));
          const links = edges.map((e: any) => ({
            ...e,
            sourceNode: nodeMap.get(e.source),
            targetNode: nodeMap.get(e.target)
          })).filter((l: any) => l.sourceNode && l.targetNode);

          const colors: Record<string, string> = {
            document: '#a855f7',
            person: '#3b82f6',
            concept: '#10b981',
            organization: '#f59e0b',
            place: '#ec4899',
            method: '#06b6d4',
            chunk: '#64748b'
          };

          const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
          const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
          marker.setAttribute('id', 'arrow-pod');
          marker.setAttribute('viewBox', '0 0 10 10');
          marker.setAttribute('refX', '18');
          marker.setAttribute('refY', '5');
          marker.setAttribute('markerWidth', '6');
          marker.setAttribute('markerHeight', '6');
          marker.setAttribute('orient', 'auto-start-reverse');
          const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
          path.setAttribute('fill', '#cbd5e1');
          marker.appendChild(path);
          defs.appendChild(marker);
          svg.appendChild(defs);

          const linkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          svg.appendChild(linkGroup);
          const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          svg.appendChild(nodeGroup);

          const linkElements = links.map((link: any) => {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('stroke', '#cbd5e1');
            line.setAttribute('stroke-width', '1.5');
            line.setAttribute('marker-end', 'url(#arrow-pod)');
            linkGroup.appendChild(line);
            return { line, link };
          });

          const nodeElements = simNodes.map((node: any) => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            g.style.cursor = 'grab';

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('r', node.kind === 'document' ? '12' : '8');
            circle.setAttribute('fill', colors[node.kind] || '#94a3b8');
            circle.setAttribute('stroke', '#ffffff');
            circle.setAttribute('stroke-width', '2');
            g.appendChild(circle);

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.textContent = node.label;
            text.setAttribute('dx', '14');
            text.setAttribute('dy', '4');
            text.setAttribute('font-size', '10px');
            text.setAttribute('fill', '#334155');
            text.setAttribute('font-weight', '500');
            text.setAttribute('font-family', 'system-ui, sans-serif');
            g.appendChild(text);

            nodeGroup.appendChild(g);
            return { g, node };
          });

          const iterations = 80;
          const k = 0.05;
          const rep = 400;

          for (let it = 0; it < iterations; it++) {
            for (let i = 0; i < simNodes.length; i++) {
              for (let j = i + 1; j < simNodes.length; j++) {
                const n1 = simNodes[i];
                const n2 = simNodes[j];
                const dx = n2.x - n1.x;
                const dy = n2.y - n1.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                if (dist < 200) {
                  const force = rep / (dist * dist);
                  const fx = (dx / dist) * force;
                  const fy = (dy / dist) * force;
                  n1.vx -= fx;
                  n1.vy -= fy;
                  n2.vx += fx;
                  n2.vy += fy;
                }
              }
            }

            for (const link of links) {
              const n1 = link.sourceNode;
              const n2 = link.targetNode;
              const dx = n2.x - n1.x;
              const dy = n2.y - n1.y;
              const dist = Math.sqrt(dx * dx + dy * dy) || 1;
              const restLen = 60;
              const force = k * (dist - restLen);
              const fx = (dx / dist) * force;
              const fy = (dy / dist) * force;
              n1.vx += fx;
              n1.vy += fy;
              n2.vx -= fx;
              n2.vy -= fy;
            }

            for (const node of simNodes) {
              const dx = width / 2 - node.x;
              const dy = height / 2 - node.y;
              node.vx += dx * 0.01;
              node.vy += dy * 0.01;
              node.x += node.vx;
              node.y += node.vy;
              node.vx *= 0.65;
              node.vy *= 0.65;
            }
          }

          function updatePositions() {
            linkElements.forEach(({ line, link }: any) => {
              line.setAttribute('x1', link.sourceNode.x);
              line.setAttribute('y1', link.sourceNode.y);
              line.setAttribute('x2', link.targetNode.x);
              line.setAttribute('y2', link.targetNode.y);
            });
            nodeElements.forEach(({ g, node }: any) => {
              g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
            });
          }
          updatePositions();

          let selectedNode: any = null;
          nodeElements.forEach(({ g, node }: any) => {
            g.addEventListener('mousedown', () => {
              selectedNode = node;
              g.style.cursor = 'grabbing';
            });
          });

          svg.addEventListener('mousemove', (e: MouseEvent) => {
            if (selectedNode) {
              const rectSvg = svg.getBoundingClientRect();
              selectedNode.x = ((e.clientX - rectSvg.left) / rectSvg.width) * width;
              selectedNode.y = ((e.clientY - rectSvg.top) / rectSvg.height) * height;
              updatePositions();
            }
          });

          window.addEventListener('mouseup', () => {
            if (selectedNode) {
              nodeElements.forEach(({ g }: any) => { g.style.cursor = 'grab'; });
              selectedNode = null;
            }
          });
        });
        return;
      }
      if (kind === 'search') {
        element.classList.remove('future-tool-pod');
        element.classList.add('search-tool-pod');
        element.style.display = 'flex';
        element.style.flexDirection = 'column';
        element.style.height = '100%';
        element.style.overflow = 'hidden';
        element.style.background = 'var(--paper)';

        const header = document.createElement('header');
        header.className = 'pod-heading';
        header.style.padding = '12px 16px';
        header.style.borderBottom = '1px solid var(--line)';

        const titleH2 = document.createElement('h2');
        titleH2.style.margin = '0 0 8px';
        titleH2.style.fontSize = '16px';
        titleH2.style.fontFamily = 'Georgia, serif';
        titleH2.textContent = 'Hybrid Corpus Search';
        header.appendChild(titleH2);

        const searchForm = document.createElement('form');
        searchForm.style.display = 'flex';
        searchForm.style.flexDirection = 'column';
        searchForm.style.gap = '8px';

        const formRow = document.createElement('div');
        formRow.style.display = 'flex';
        formRow.style.gap = '8px';

        const searchInput = document.createElement('input');
        searchInput.type = 'search';
        searchInput.placeholder = 'Search exact phrase, semantic concept...';
        searchInput.style.flex = '1';
        searchInput.style.padding = '6px 10px';
        searchInput.style.border = '1px solid var(--line)';
        searchInput.style.background = '#ffffff';
        searchInput.style.fontSize = '13px';

        const searchButton = document.createElement('button');
        searchButton.type = 'submit';
        searchButton.textContent = 'Search';
        searchButton.style.padding = '6px 14px';
        searchButton.style.background = 'var(--ink)';
        searchButton.style.color = 'var(--paper)';
        searchButton.style.border = '0';
        searchButton.style.fontSize = '13px';
        searchButton.style.fontWeight = '600';
        searchButton.style.cursor = 'pointer';

        formRow.append(searchInput, searchButton);
        searchForm.appendChild(formRow);

        const modesDiv = document.createElement('div');
        modesDiv.style.display = 'flex';
        modesDiv.style.gap = '12px';
        modesDiv.style.fontSize = '11px';
        modesDiv.style.color = 'var(--muted)';

        ['hybrid', 'lexical', 'semantic', 'graph'].forEach((m, idx) => {
          const label = document.createElement('label');
          label.style.display = 'flex';
          label.style.alignItems = 'center';
          label.style.gap = '4px';
          label.style.cursor = 'pointer';
          const radio = document.createElement('input');
          radio.type = 'radio';
          radio.name = 'search-mode';
          radio.value = m;
          if (idx === 0) radio.checked = true;
          label.append(radio, document.createTextNode(m));
          modesDiv.appendChild(label);
        });
        searchForm.appendChild(modesDiv);
        header.appendChild(searchForm);
        element.appendChild(header);

        const status = document.createElement('div');
        status.style.padding = '6px 16px';
        status.style.fontSize = '11px';
        status.style.color = 'var(--muted)';
        status.style.borderBottom = '1px solid var(--line)';
        status.textContent = 'Ready to inspect the corpus.';
        element.appendChild(status);

        const resultsContainer = document.createElement('div');
        resultsContainer.style.flex = '1';
        resultsContainer.style.overflowY = 'auto';
        resultsContainer.style.padding = '16px';
        element.appendChild(resultsContainer);

        const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char] || char);
        const renderSnippet = (value: string) => esc(value).replaceAll('‹', '<mark>').replaceAll('›', '</mark>');

        searchForm.addEventListener('submit', async (evSubmit) => {
          evSubmit.preventDefault();
          const query = searchInput.value.trim();
          if (query.length < 2) return;

          status.textContent = 'Searching lexical, vector and graph evidence…';
          resultsContainer.innerHTML = '';
          const modeVal = (searchForm.querySelector('input[name="search-mode"]:checked') as HTMLInputElement)?.value || 'hybrid';

          try {
            const params = new URLSearchParams({ q: query, mode: modeVal });
            const response = await fetch(`/api/search/corpus?${params}`);
            const payloadData = await response.json();
            if (!response.ok) throw new Error(payloadData.error || 'Search failed');

            status.textContent = `${payloadData.items.length} evidence fragments · vector ${payloadData.capabilities.vector ? 'online' : 'deferred'}`;

            const grouped = new Map<string, any[]>();
            payloadData.items.forEach((item: any) => grouped.set(item.referenceId, [...(grouped.get(item.referenceId) || []), item]));

            if (grouped.size === 0) {
              resultsContainer.innerHTML = '<div style="color:var(--muted);font-family:monospace;font-size:12px;text-align:center;padding:40px;">No evidence found in the indexed corpus.</div>';
              return;
            }

            [...grouped.values()].forEach((items) => {
              const first = items[0];
              const groupArt = document.createElement('article');
              groupArt.className = 'corpus-result-group';
              groupArt.style.marginBottom = '24px';

              const grpHdr = document.createElement('header');
              grpHdr.style.display = 'flex';
              grpHdr.style.justifyContent = 'space-between';
              grpHdr.style.alignItems = 'start';
              grpHdr.style.borderBottom = '1px solid var(--line)';
              grpHdr.style.paddingBottom = '6px';
              grpHdr.style.marginBottom = '12px';

              const titleWrapper = document.createElement('div');
              const citeSpan = document.createElement('span');
              citeSpan.style.fontFamily = 'monospace';
              citeSpan.style.fontSize = '11px';
              citeSpan.style.color = 'var(--muted)';
              citeSpan.textContent = `@${first.citeKey}`;

              const h3 = document.createElement('h3');
              h3.style.margin = '4px 0 0';
              h3.style.fontSize = '15px';
              h3.style.fontFamily = 'Georgia, serif';
              
              const titleLink = document.createElement('a');
              titleLink.href = '#';
              titleLink.textContent = first.title;
              titleLink.style.textDecoration = 'none';
              titleLink.style.color = 'var(--green)';
              titleLink.addEventListener('click', (ev) => {
                ev.preventDefault();
                controller.openDocument(first.referenceId);
              });

              h3.appendChild(titleLink);
              titleWrapper.append(citeSpan, h3);

              const occurrences = items.reduce((sum, item) => sum + Number(item.occurrences || 0), 0);
              const occStr = document.createElement('strong');
              occStr.style.fontSize = '11px';
              occStr.style.color = 'var(--muted)';
              occStr.textContent = `${occurrences || items.length} ${occurrences === 1 ? 'occurrence' : 'occurrences'}`;

              grpHdr.append(titleWrapper, occStr);
              groupArt.appendChild(grpHdr);

              const ol = document.createElement('ol');
              ol.style.listStyle = 'none';
              ol.style.padding = '0';
              ol.style.margin = '0';

              items.forEach((item) => {
                const li = document.createElement('li');
                li.style.marginBottom = '12px';

                const a = document.createElement('a');
                a.href = '#';
                a.style.display = 'block';
                a.style.textDecoration = 'none';
                a.style.color = 'inherit';
                a.addEventListener('click', (ev) => {
                  ev.preventDefault();
                  controller.openDocument(item.referenceId);
                });

                const b = document.createElement('b');
                b.style.fontSize = '9px';
                b.style.fontFamily = 'monospace';
                b.style.color = 'var(--green)';
                b.style.textTransform = 'uppercase';
                b.textContent = item.locator || item.section || `fragment ${item.metadata?.ordinal ?? ''}`;

                const p = document.createElement('p');
                p.style.margin = '4px 0';
                p.style.fontSize = '13px';
                p.style.fontFamily = 'Georgia, serif';
                p.style.lineHeight = '1.4';
                p.innerHTML = renderSnippet(item.snippet);

                const channelsSmall = document.createElement('small');
                channelsSmall.style.fontSize = '9px';
                channelsSmall.style.fontFamily = 'monospace';
                channelsSmall.style.color = 'var(--muted)';
                channelsSmall.textContent = item.channels.map(esc).join(' · ');

                a.append(b, p, channelsSmall);
                li.appendChild(a);
                ol.appendChild(li);
              });

              groupArt.appendChild(ol);
              resultsContainer.appendChild(groupArt);
            });
          } catch (err: any) {
            status.textContent = err?.message || 'Search failed';
          }
        });
        return;
      }
      const glyph = kind === 'analysis' ? '⌁' : kind === 'annotation' ? '✎' : '✣';
      const heading = document.createElement('div'); heading.className = 'future-tool-glyph'; heading.textContent = glyph; element.appendChild(heading);
      const title = document.createElement('h2'); title.textContent = kind === 'agent' ? 'Agent workspace' : `${kind[0].toUpperCase()}${kind.slice(1)} workspace`; element.appendChild(title);
      const copy = document.createElement('p'); copy.textContent = reference
        ? `Context attached to “${reference.title}”. This pod slot is ready for its own lifecycle and persistence.`
        : 'Open a document first to attach evidence and provenance to this pod.'; element.appendChild(copy);
    }, dispose() { disposed = true; disposeAnnotation(); } };
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
      if (name === 'document-preview') return previewRenderer();
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
    openDocument(referenceId: string, split = false) {
      activeReference = referenceId; const ref = references.get(referenceId); if (!ref) return;
      if (split) { addPanel(`document-split-${referenceId}-${Date.now()}`, `document:${referenceId}`, ref.title, 'right'); return; }
      const existing = api.getPanel('document-preview');
      if (existing) { previewRender?.(referenceId); existing.api.setTitle(ref.title); existing.api.setActive(); }
      else addPanel('document-preview', 'document-preview', ref.title, 'right');
    },
    openDerivative(referenceId: string, kind: 'text' | 'structure') { const ref = references.get(referenceId); addPanel(`${kind}-${referenceId}`, `${kind}:${referenceId}`, `${kind === 'text' ? 'Text' : 'Structure'} · ${ref?.title || ''}`, 'right'); },
    openTool(kind: ToolKind, referenceId = activeReference || undefined) {
      const suffix = referenceId || 'global';
      let title = kind === 'agent' ? 'AI agent' : kind[0].toUpperCase() + kind.slice(1);
      if (kind === 'graph') title = referenceId ? 'Document Graph' : 'Global Graph';
      if (kind === 'search') title = 'Corpus Search';
      addPanel(`tool-${kind}-${suffix}`, `tool:${kind}:${referenceId || ''}`, title, 'right');
    },
    openBibliography(batchId: string, title = 'Bibliography') { addPanel(`bibliography-${batchId}`, `bibliography:${batchId}`, title, 'right'); },
  };

  async function deleteReference(referenceId: string) {
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
      selectedReferences.delete(referenceId);
      const index = payload.references.findIndex((item) => item.id === referenceId);
      if (index >= 0) payload.references.splice(index, 1);
      if (activeReference === referenceId) activeReference = null;
      refreshTable();
      renderTree(search?.value || '');
      updateActivity(activityId, { state: 'complete', message: `${reference.title} · deleted from catalog and R2` });
      setSaveState('deleted');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      updateActivity(activityId, { state: 'error', message: `${reference.title} · ${message}` });
      setSaveState(message, 'error');
    }
  }

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

  let contextMenu: HTMLElement | null = null;
  const closeContextMenu = () => { contextMenu?.remove(); contextMenu = null; };
  const openContextMenu = (event: MouseEvent, items: Array<{ label: string; danger?: boolean; disabled?: boolean; action: () => void | Promise<void> }>) => {
    event.preventDefault(); event.stopPropagation(); closeContextMenu();
    const menu = document.createElement('div'); menu.className = 'seshat-context-menu'; menu.setAttribute('role', 'menu');
    items.forEach((item) => {
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.textContent = item.label;
      button.disabled = Boolean(item.disabled); button.classList.toggle('danger', Boolean(item.danger));
      button.addEventListener('click', () => { closeContextMenu(); void item.action(); }); menu.appendChild(button);
    });
    root.appendChild(menu); contextMenu = menu;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(event.clientX, window.innerWidth - bounds.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(event.clientY, window.innerHeight - bounds.height - 6))}px`;
  };
  document.addEventListener('pointerdown', (event) => { if (contextMenu && !contextMenu.contains(event.target as Node)) closeContextMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });
  window.addEventListener('blur', closeContextMenu);

  const renderTree = (query = '') => {
    tree.replaceChildren();
    const makeButton = (label: string, count: number, libraryId: string | null) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tree-node';
      button.classList.toggle('active', activeLibrary === libraryId); button.dataset.libraryId = libraryId || '';
      const text = document.createElement('span'); text.textContent = label; const badge = document.createElement('b'); badge.textContent = String(count);
      button.append(text, badge); button.addEventListener('click', () => { activeLibrary = libraryId; refreshTable(); renderTree(search.value); controller.openCatalog(); });
      return button;
    };
    const matched = payload.references.filter((reference) => !query || [reference.title, reference.contributorsDisplay, reference.citeKey].some((value) => normalize(value).includes(normalize(query))));
    const moveReference = async (reference: ReferenceRow, libraryIds: string[]) => {
      const response = await fetch(`/api/library/${reference.id}/libraries`, { method: 'PUT', headers: {'content-type':'application/json'}, body: JSON.stringify({ libraryIds }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not move reference.');
      reference.libraryIds = result.libraryIds; renderTree(search.value); refreshTable();
    };
    const dragReferenceIds = (event: DragEvent) => {
      const bundled = event.dataTransfer?.getData('application/x-seshat-references');
      if (bundled) {
        try {
          const parsed = JSON.parse(bundled);
          if (Array.isArray(parsed)) return parsed.filter((id) => typeof id === 'string');
        } catch {}
      }
      const single = event.dataTransfer?.getData('application/x-seshat-reference');
      return single ? [single] : [];
    };
    const moveReferences = async (ids: string[], targetLibraryId: string | null, add = false) => {
      const unique = [...new Set(ids)]
        .map((id) => references.get(id))
        .filter((reference): reference is ReferenceRow => reference !== undefined && reference.access !== 'viewer');
      for (const reference of unique) {
        const next = targetLibraryId
          ? (add ? [...new Set([...reference.libraryIds, targetLibraryId])] : [targetLibraryId])
          : [];
        await moveReference(reference, next);
      }
      setSaveState(unique.length === 1 ? (targetLibraryId ? 'reference moved' : 'moved outside libraries') : `${unique.length} references moved`);
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
      const referenceIds = dragReferenceIds(event);
      const library = payload.libraries.find((item) => item.id === event.dataTransfer?.getData('application/x-seshat-library'));
      try {
        if (referenceIds.length) await moveReferences(referenceIds, null);
        else if (library) { await moveLibrary(library, null); setSaveState('library moved to root'); }
      } catch (error) { setSaveState(error instanceof Error ? error.message : 'Move failed', 'error'); }
    });
    tree.appendChild(allButton);
    const children = (parentId?: string) => payload.libraries.filter((library) => (library.parentId || undefined) === parentId);
    const createFolder = async (library: LibraryNode) => {
      const name = await requestText('Create folder', `Name inside “${library.name}”`, '', 'Create'); if (!name) return;
      const response = await fetch('/api/libraries', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ name, parentId: library.id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setSaveState(result.error || 'Could not create folder', 'error'); return; }
      payload.libraries.push(result.library); renderTree(search.value); setSaveState('folder created');
    };
    const renameLibrary = async (library: LibraryNode) => {
      const kind = library.parentId ? 'folder' : 'library';
      const next = await requestText(`Rename ${kind}`, 'Name', library.name, 'Rename'); if (!next || next === library.name) return;
      const response = await fetch(`/api/libraries/${library.id}`, { method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({ name: next }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setSaveState(result.error || 'Rename failed', 'error'); return; }
      library.name = result.library.name; renderTree(search.value); setSaveState(`${kind} renamed`);
    };
    const shareLibrary = async (library: LibraryNode) => {
      const dialog = dialogShell('Share library');
      dialog.classList.add('share-search-dialog');
      const form = document.createElement('form'); form.className = 'dialog-share-search';
      const heading = document.createElement('p'); heading.textContent = `Share “${library.name}” with a registered Musiki user or group.`;
      const input = document.createElement('input'); input.type = 'search'; input.autocomplete = 'off'; input.placeholder = 'Search users, groups, course or year…'; input.setAttribute('aria-label', 'Search Musiki users and groups');
      const status = document.createElement('p'); status.className = 'share-search-status'; status.setAttribute('aria-live', 'polite');
      const results = document.createElement('div'); results.className = 'share-search-results'; results.setAttribute('role', 'listbox');
      const footer = document.createElement('footer');
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
      const manual = document.createElement('button'); manual.type = 'submit'; manual.className = 'primary'; manual.textContent = 'Share email'; manual.disabled = true;
      footer.append(cancel, manual); form.append(heading, input, status, results, footer); dialog.appendChild(form);

      let searchTimer = 0;
      let requestController: AbortController | null = null;
      const setBusy = (busy: boolean) => {
        input.disabled = busy;
        results.querySelectorAll<HTMLButtonElement>('button').forEach((button) => { button.disabled = busy; });
        manual.disabled = busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
      };
      const submitTarget = async (target: ShareTarget) => {
        const emails = target.type === 'group' ? target.emails || [] : target.email ? [target.email] : [];
        if (!emails.length) return;
        setBusy(true); status.textContent = target.type === 'group' ? `Sharing with ${emails.length} group members…` : 'Sharing…';
        const response = await fetch(`/api/libraries/${library.id}/shares`, {
          method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ emails }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) { setBusy(false); status.textContent = result.error || 'Share failed'; status.dataset.tone = 'error'; return; }
        setSaveState(`shared with ${target.label}`); dialog.close();
      };
      const renderTargets = (targets: ShareTarget[]) => {
        results.replaceChildren();
        if (!targets.length) { status.textContent = 'No registered users or groups found.'; return; }
        status.textContent = `${targets.length} ${targets.length === 1 ? 'match' : 'matches'}`;
        targets.forEach((target) => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'share-search-option'; button.setAttribute('role', 'option');
          const kind = document.createElement('span'); kind.className = 'share-search-kind'; kind.textContent = target.type === 'group' ? 'GROUP' : 'USER';
          const copy = document.createElement('span'); copy.className = 'share-search-copy';
          const label = document.createElement('strong'); label.textContent = target.label;
          const detail = document.createElement('small'); detail.textContent = target.type === 'group' ? `${target.memberCount || target.emails?.length || 0} members` : target.email || '';
          copy.append(label, detail); button.append(kind, copy); button.addEventListener('click', () => void submitTarget(target)); results.appendChild(button);
        });
      };
      const loadTargets = async () => {
        requestController?.abort(); requestController = new AbortController();
        status.dataset.tone = ''; status.textContent = 'Searching Musiki…';
        try {
          const response = await fetch(`/api/share-targets?q=${encodeURIComponent(input.value.trim())}`, { signal: requestController.signal });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Could not search Musiki.');
          renderTargets(Array.isArray(result.targets) ? result.targets : []);
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') return;
          results.replaceChildren(); status.dataset.tone = 'error'; status.textContent = error instanceof Error ? error.message : 'Could not search Musiki.';
        }
      };

      input.addEventListener('input', () => {
        manual.disabled = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
        window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => void loadTargets(), 180);
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault(); const email = input.value.trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) void submitTarget({ id: `manual:${email}`, type: 'user', label: email, email });
      });
      cancel.addEventListener('click', () => dialog.close());
      dialog.addEventListener('close', () => { window.clearTimeout(searchTimer); requestController?.abort(); });
      window.requestAnimationFrame(() => { input.focus(); void loadTargets(); });
    };
    const manageSharing = async (library: LibraryNode) => {
      const response = await fetch(`/api/libraries/${library.id}/shares`); const result = await response.json().catch(() => ({}));
      if (!response.ok) { setSaveState(result.error || 'Could not read sharing', 'error'); return; }
      const dialog = dialogShell(`Sharing · ${library.name}`); const body = document.createElement('div'); body.className = 'dialog-sharing'; dialog.appendChild(body);
      const render = () => {
        body.replaceChildren(); const shares = result.shares || [];
        if (!shares.length) { const empty = document.createElement('p'); empty.textContent = 'This library is not shared yet.'; body.appendChild(empty); }
        shares.forEach((share:any) => {
          const row = document.createElement('div'); const email = document.createElement('span'); email.textContent = share.email;
          const revoke = document.createElement('button'); revoke.type = 'button'; revoke.textContent = 'Revoke'; revoke.className = 'danger quiet';
          revoke.addEventListener('click', async () => {
            revoke.disabled = true; const response = await fetch(`/api/libraries/${library.id}/shares?email=${encodeURIComponent(share.email)}`, { method: 'DELETE' });
            const revoked = await response.json().catch(() => ({}));
            if (!response.ok) { revoke.disabled = false; setSaveState(revoked.error || 'Could not revoke access', 'error'); return; }
            result.shares = shares.filter((item:any) => item.email !== share.email); render(); setSaveState(`access revoked for ${share.email}`);
          }); row.append(email, revoke); body.appendChild(row);
        });
        const add = document.createElement('button'); add.type = 'button'; add.className = 'primary'; add.textContent = 'Share with another user';
        add.addEventListener('click', () => { dialog.close(); void shareLibrary(library); }); body.appendChild(add);
      };
      render();
    };
    const deleteLibrary = async (library: LibraryNode) => {
      const kind = library.parentId ? 'folder' : 'library';
      if (!await confirmAction(`Delete ${kind}`, `Delete “${library.name}” and its subfolders? References will remain in the catalog.`, `Delete ${kind}`)) return;
      const response = await fetch(`/api/libraries/${library.id}`, { method: 'DELETE' }); const result = await response.json().catch(() => ({}));
      if (!response.ok) { setSaveState(result.error || 'Delete failed', 'error'); return; }
      const removeIds = new Set<string>([library.id]); let changed = true;
      while (changed) { changed = false; payload.libraries.forEach((item) => { if (item.parentId && removeIds.has(item.parentId) && !removeIds.has(item.id)) { removeIds.add(item.id); changed = true; } }); }
      payload.libraries = payload.libraries.filter((item) => !removeIds.has(item.id)); payload.references.forEach((item) => { item.libraryIds = item.libraryIds.filter((id) => !removeIds.has(id)); });
      if (activeLibrary && removeIds.has(activeLibrary)) activeLibrary = null; renderTree(search.value); refreshTable(); setSaveState(`${kind} deleted`);
    };
    const libraryBranchIds = (libraryId: string) => {
      const ids = new Set([libraryId]); let changed = true;
      while (changed) {
        changed = false;
        payload.libraries.forEach((item) => {
          if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) { ids.add(item.id); changed = true; }
        });
      }
      return ids;
    };
    const exportLibrary = (library: LibraryNode) => {
      const branch = libraryBranchIds(library.id);
      const rows = payload.references.filter((reference) => reference.libraryIds.some((id) => branch.has(id)));
      if (!rows.length) { setSaveState('library has no references to export', 'error'); return; }
      const blob = new Blob([toBetterBibtex(rows)], { type: 'application/x-bibtex;charset=utf-8' });
      const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
      link.download = `${library.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'seshat-library'}.bib`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      setSaveState(`${rows.length} references exported as Better BibTeX`);
    };
    const appendLibrary = (library: LibraryNode, container: HTMLElement) => {
      const details = document.createElement('details'); details.open = Boolean(query) || !collapsedLibraries.has(library.id); details.className = 'tree-branch';
      const summary = document.createElement('summary'); summary.draggable = !library.id.startsWith('inbox:');
      const own = matched.filter((reference) => reference.libraryIds.includes(library.id));
      const libraryRow = document.createElement('div'); libraryRow.className = 'tree-library-row';
      const fold = document.createElement('button'); fold.type = 'button'; fold.className = 'tree-fold';
      fold.textContent = details.open ? '▾' : '▸'; fold.title = details.open ? 'Collapse' : 'Expand'; fold.setAttribute('aria-label', fold.title);
      fold.addEventListener('click', (event) => {
        event.preventDefault(); event.stopPropagation(); details.open = !details.open;
        if (details.open) collapsedLibraries.delete(library.id); else collapsedLibraries.add(library.id);
        window.localStorage.setItem(TREE_STATE_KEY, JSON.stringify([...collapsedLibraries]));
        fold.textContent = details.open ? '▾' : '▸'; fold.title = details.open ? 'Collapse' : 'Expand'; fold.setAttribute('aria-label', fold.title);
      });
      libraryRow.appendChild(fold);
      libraryRow.appendChild(makeButton(library.name, own.length, library.id));
      const menuItems = () => {
        const items: Array<{ label: string; danger?: boolean; action: () => void | Promise<void> }> = [
          { label: 'Export as Better BibTeX (.bib)', action: () => exportLibrary(library) },
        ];
        if (library.access !== 'viewer') items.unshift({ label: 'New folder inside', action: () => createFolder(library) });
        if (library.access !== 'viewer' && !library.id.startsWith('inbox:')) items.push(
          { label: `Rename ${library.parentId ? 'folder' : 'library'}…`, action: () => renameLibrary(library) },
          { label: 'Share with Musiki user…', action: () => shareLibrary(library) },
          { label: 'Manage sharing…', action: () => manageSharing(library) },
          { label: `Delete ${library.parentId ? 'folder' : 'library'}…`, danger: true, action: () => deleteLibrary(library) },
        );
        return items;
      };
      summary.addEventListener('contextmenu', (event) => openContextMenu(event, menuItems()));
      if (library.access !== 'viewer') {
        const actions = document.createElement('span'); actions.className = 'tree-library-actions';
        const more = document.createElement('button'); more.type = 'button'; more.textContent = '⋯'; more.title = 'Library and folder actions'; more.setAttribute('aria-label', `Actions for ${library.name}`);
        more.addEventListener('click', (event) => openContextMenu(event, menuItems()));
        let longPressTimer: number | null = null;
        const clearLongPress = () => { if (longPressTimer) window.clearTimeout(longPressTimer); longPressTimer = null; };
        summary.addEventListener('pointerdown', (event) => {
          if (event.pointerType !== 'touch') return;
          clearLongPress();
          longPressTimer = window.setTimeout(() => openContextMenu(event, menuItems()), 560);
        });
        summary.addEventListener('pointermove', clearLongPress);
        summary.addEventListener('pointerup', clearLongPress);
        summary.addEventListener('pointercancel', clearLongPress);
        actions.append(more); libraryRow.appendChild(actions);
      } else if (library.access === 'viewer') {
        const shared = document.createElement('span'); shared.className = 'tree-shared';
        shared.textContent = 'shared'; shared.title = library.sharedByEmail ? `Shared by ${library.sharedByEmail}` : 'Shared library';
        libraryRow.appendChild(shared);
        let longPressTimer: number | null = null;
        const clearLongPress = () => { if (longPressTimer) window.clearTimeout(longPressTimer); longPressTimer = null; };
        summary.addEventListener('pointerdown', (event) => {
          if (event.pointerType !== 'touch') return;
          clearLongPress(); longPressTimer = window.setTimeout(() => openContextMenu(event, menuItems()), 560);
        });
        summary.addEventListener('pointermove', clearLongPress);
        summary.addEventListener('pointerup', clearLongPress);
        summary.addEventListener('pointercancel', clearLongPress);
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
        const referenceIds = dragReferenceIds(event);
        if (!referenceIds.length) return;
        try {
          await moveReferences(referenceIds, library.id, event.altKey);
          if (event.altKey) setSaveState(referenceIds.length === 1 ? 'added to library' : `${referenceIds.length} references added to library`);
        } catch (error) { setSaveState(error instanceof Error ? error.message : 'Move failed', 'error'); }
      });
      const nested = document.createElement('div'); nested.className = 'tree-children';
      children(library.id).forEach((child) => appendLibrary(child, nested));
      own.slice(0, 100).forEach((reference) => {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'tree-reference'; item.title = reference.title;
        item.classList.toggle('selected', selectedReferences.has(reference.id));
        item.draggable = reference.access !== 'viewer';
        const glyph = document.createElement('span'); glyph.textContent = reference.format === 'pdf' ? '▧' : '≡';
        const title = document.createElement('span'); title.textContent = reference.title; item.append(glyph, title);
        item.addEventListener('click', (event) => {
          if (event.detail > 1) return;
          if (event.metaKey || event.ctrlKey) {
            if (selectedReferences.has(reference.id)) selectedReferences.delete(reference.id);
            else selectedReferences.add(reference.id);
          } else {
            selectedReferences.clear(); selectedReferences.add(reference.id);
          }
          renderTree(search.value);
          setSaveState(`${selectedReferences.size} selected`);
        });
        item.addEventListener('dblclick', (event) => controller.openDocument(reference.id, event.altKey));
        item.addEventListener('contextmenu', (event) => {
          if (!selectedReferences.has(reference.id)) {
            selectedReferences.clear(); selectedReferences.add(reference.id); renderTree(search.value);
          }
          openContextMenu(event, referenceMenuItems(selectedIds()));
        });
        item.addEventListener('dragover', (event) => {
          if (!event.dataTransfer?.types.includes('Files')) return;
          event.preventDefault(); event.stopPropagation(); item.classList.add('associated-drop-target');
        });
        item.addEventListener('dragleave', () => item.classList.remove('associated-drop-target'));
        item.addEventListener('drop', (event) => {
          if (!event.dataTransfer?.files.length) return;
          event.preventDefault(); event.stopPropagation(); item.classList.remove('associated-drop-target');
          const file = event.dataTransfer.files[0];
          if (file && reference.access === 'owner') void replaceAssociatedFile(reference.id, file);
        });
        let referenceLongPress: number | null = null;
        const clearReferenceLongPress = () => { if (referenceLongPress) window.clearTimeout(referenceLongPress); referenceLongPress = null; };
        item.addEventListener('pointerdown', (event) => {
          if (event.pointerType !== 'touch') return;
          clearReferenceLongPress();
          referenceLongPress = window.setTimeout(() => {
            if (!selectedReferences.has(reference.id)) {
              selectedReferences.clear(); selectedReferences.add(reference.id); renderTree(search.value);
            }
            openContextMenu(event, referenceMenuItems(selectedIds()));
          }, 560);
        });
        item.addEventListener('pointermove', clearReferenceLongPress);
        item.addEventListener('pointerup', clearReferenceLongPress);
        item.addEventListener('pointercancel', clearReferenceLongPress);
        item.addEventListener('dragstart', (event) => {
          if (!selectedReferences.has(reference.id)) { selectedReferences.clear(); selectedReferences.add(reference.id); renderTree(search.value); }
          const ids = [...selectedReferences].filter((id) => references.get(id)?.access !== 'viewer');
          if (!ids.length) { event.preventDefault(); return; }
          event.dataTransfer?.setData('application/x-seshat-references', JSON.stringify(ids));
          event.dataTransfer?.setData('application/x-seshat-reference', ids[0]);
          setSaveState(`${ids.length} selected`);
        });
        nested.appendChild(item);
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
        updateActivity(activityId, { state: 'complete', message: `${status.reference.title} · metadata and summary ready`, referenceId, mapReady: status.reference.hasStructure });
        return;
      }
      const active = status.pipeline.find((job:any) => job.status === 'running' || job.status === 'queued');
      updateActivity(activityId, { message: `${filename} · ${stageMessage[active?.stage] || 'Waiting for worker'}`, referenceId });
      await wait(4000);
    }
    updateActivity(activityId, { state: 'error', message: `${filename} · processing timed out` });
  };

  const replaceAssociatedFile = async (referenceId: string, file: File) => {
    const reference = references.get(referenceId);
    if (!reference || reference.access !== 'owner') { setSaveState('This reference is read-only', 'error'); return; }
    if (file.name.toLowerCase().endsWith('.bib')) { setSaveState('A .bib file cannot replace a document', 'error'); return; }
    const activityId = `replace-${referenceId}-${crypto.randomUUID()}`;
    updateActivity(activityId, { state: 'working', referenceId, message: `${reference.title} · replacing associated file with ${file.name}` });
    const form = new FormData(); form.set('file', file, file.name);
    try {
      const response = await fetch(`/api/library/${referenceId}/file`, { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'File replacement failed.');
      const row = rowFromCatalogReference(result.reference); upsertRow(row);
      updateActivity(activityId, { state: 'working', referenceId, message: `${reference.title} · extracting replacement text and structure` });
      void followPipeline(referenceId, activityId, file.name).catch((error) => {
        updateActivity(activityId, { state: 'error', message: `${reference.title} · ${error instanceof Error ? error.message : 'status unavailable'}` });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File replacement failed';
      updateActivity(activityId, { state: 'error', referenceId, message: `${reference.title} · ${message}` });
      setSaveState(message, 'error');
    }
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

  document.addEventListener('keydown', (event) => {
    if (!event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'a' && key !== 'b') return;
    const target = event.target as HTMLElement | null;
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    const ids = selectedReferences.size ? [...selectedReferences] : activeReference ? [activeReference] : [];
    copyReferences(ids, key === 'a' ? 'apa' : 'bibtex');
  });

  consoleToggle.addEventListener('click', () => {
    const expanded = consoleDrawer.hidden;
    consoleDrawer.hidden = !expanded;
    consoleToggle.setAttribute('aria-expanded', String(expanded));
  });

  search.addEventListener('input', () => renderTree(search.value));
  root.querySelector<HTMLButtonElement>('[data-new-library]')?.addEventListener('click', async () => {
    const name = await requestText(activeLibrary ? 'Create folder' : 'Create library', 'Name', '', 'Create');
    if (!name) return;
    const response = await fetch('/api/libraries', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ name, parentId: activeLibrary }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setSaveState(result.error || 'Could not create library', 'error'); return; }
    payload.libraries.push(result.library); renderTree(search.value); setSaveState('library created');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-open-tool]').forEach((button) => button.addEventListener('click', () => controller.openTool(button.dataset.openTool as ToolKind)));
  renderTree();
}
