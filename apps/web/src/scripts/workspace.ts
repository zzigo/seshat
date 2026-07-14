import Handsontable from 'handsontable';
import type { BaseRenderer } from 'handsontable/renderers';
import { registerAllModules } from 'handsontable/registry';
import { createDockview, type DockviewApi, type IContentRenderer } from 'dockview-core';
import { BIBLATEX_ENTRY_TYPE_OPTIONS, BIBLATEX_ENTRY_TYPE_VALUES, BIBLATEX_FIELD_KEYS, BIBLATEX_FIELD_OPTIONS, CONTRIBUTOR_ROLES, biblatexEntryTypeFor, biblatexFieldsFor, contributorSummary, normalizeBibliographicType, normalizeContributor, normalizeContributors, normalizeSmartFolderFilters, parsePublicationYear, potentialDuplicateFingerprint, referenceMatchesSmartFolder, smartFolderHasFilters, type Contributor, type SmartFolderFilters } from '@seshat/core';
import { mountAnnotationWorkspace } from './annotations';
import { mountPdfViewer, navigatePdfToPage } from './pdf-viewer';
import { mountEpubReader } from './epub-reader';
import { referenceFileType } from '../lib/reference-file';
import screenfull from 'screenfull';
import ForceGraph from 'force-graph';
import { forceCollide, forceRadial, forceY } from 'd3-force-3d';
import { KOKORO_VOICES, narrationCharacterCount, normalizeReaderLanguage, readAloud } from './read-aloud';
import { CHIRP_VOICES } from '../lib/chirp';

registerAllModules();

type ReferenceRow = {
  id: string; citeKey: string; type: string; title: string; contributors: Contributor[]; contributorsDisplay: string; year: number | string;
  isbn: string; language: string; tags: string; keywords: string[]; abstract: string; format: string; fileType: string; filename: string;
  publisher: string; publisherPlace: string; url: string; dateAdded: string;
  bibliographicFields: Record<string,string>;
  sizeBytes: number;
  libraryIds: string[]; status: string; hasOriginal: boolean; hasStructure: boolean; hasText: boolean; hasKokoroNarration: boolean; hasChirpNarration: boolean; needsOcr: boolean; access: 'owner' | 'viewer';
};
type LibraryNode = { id: string; name: string; description?: string; parentId?: string; itemCount: number; access: 'owner' | 'viewer'; sharedByEmail?: string };
type SmartFolderNode = { id: string; name: string; filters: SmartFolderFilters; createdAt: string; updatedAt: string };
type WorkspacePayload = { references: ReferenceRow[]; libraries: LibraryNode[]; smartFolders: SmartFolderNode[]; keywordStyles: Record<string,string>; chirpEnabled:boolean };
type ShareTarget = { id: string; type: 'user' | 'group'; label: string; email?: string; emails?: string[]; memberCount?: number };
type ToolKind = 'analysis' | 'annotation' | 'agent' | 'graph' | 'search';
type Activity = { id: string; message: string; state: 'working' | 'complete' | 'error'; referenceId?: string; mapReady?: boolean };
const PERSON_ROLE_LABELS:Partial<Record<Contributor['role'],string>>={author:'author',editor:'editor',translator:'translator',composer:'composer',performer:'performer',curator:'curator',producer:'producer',director:'director',conductor:'conductor',commentator:'commentator',annotator:'annotator',introduction:'introduction by',foreword:'foreword / prologue by',afterword:'afterword by',contributor:'other contributor'};

const STORAGE_KEY = 'seshat.workspace.layout.v1';
const TREE_STATE_KEY = 'seshat.workspace.tree.v1';
const TREE_ORDER_KEY = 'seshat.workspace.tree-order.v1';
const TREE_LAST_READ_KEY = 'seshat.workspace.last-read.v1';
const GRAPH_SIDEBAR_KEY = 'seshat.workspace.graph-sidebar.v1';
const readPayload = (): WorkspacePayload => JSON.parse(document.getElementById('seshat-workspace-data')?.textContent || '{"references":[],"libraries":[]}');
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
const isInboxLibraryId = (id: string) => id.startsWith('inbox:');
const isUnfiledReference = (reference: ReferenceRow) => reference.access === 'owner'
  && !reference.libraryIds.some((id) => !isInboxLibraryId(id));
const treeReferenceKind = (reference: ReferenceRow): 'pdf' | 'ebook' | 'text' | 'no-text' => {
  if (reference.format === 'pdf') return 'pdf';
  if (['epub', 'mobi', 'azw', 'azw3'].includes(reference.format)) return 'ebook';
  if (reference.hasText || ['txt', 'md', 'rtf'].includes(reference.format)) return 'text';
  return 'no-text';
};
const referenceState = (reference: any): string => {
  const active = (reference.jobs || []).find((job:any) => job.status === 'running' || job.status === 'queued');
  const failed = (reference.jobs || []).find((job:any) => job.status === 'failed');
  const hasOriginal = (reference.artifacts || []).some((artifact:any) => artifact.kind === 'original');
  const hasText = (reference.artifacts || []).some((artifact:any) => artifact.kind === 'markdown');
  if (active) return active.stage;
  if (failed) return 'failed';
  if (!hasOriginal) return 'missing file';
  if (!hasText) return 'no extracted text';
  return 'ready';
};
const bibliographicFieldsFromReference=(reference:any):Record<string,string>=>{const source=reference.source||{};const values={...(source.bibtex||{}),...(source.biblatexFields||{})};const allowed=new Set<string>(BIBLATEX_FIELD_KEYS);return Object.fromEntries(Object.entries(values).filter(([key])=>allowed.has(key)).map(([key,value])=>[key,Array.isArray(value)?value.map(String).join('; '):String(value||'')]).filter(([,value])=>value));};
const rowFromCatalogReference = (reference: any): ReferenceRow => ({
  id: reference.id,
  citeKey: reference.citeKey,
  type: normalizeBibliographicType(reference.type),
  title: reference.title,
  contributors: normalizeContributors(reference.contributors || []),
  contributorsDisplay: contributorSummary(reference.contributors || []),
  year: reference.issued?.year || '',
  isbn: (reference.identifiers?.isbn || []).join('; '),
  language: reference.language || '',
  tags: (reference.tags || []).join(', '),
  keywords: Array.isArray(reference.source?.keywords) ? reference.source.keywords.map(String) : String(reference.source?.bibtex?.keywords || '').split(/[,;\n]+/).map((item) => item.trim()).filter(Boolean),
  abstract: reference.abstract || '',
  publisher: reference.publisher || '',
  publisherPlace: reference.publisherPlace || '',
  url: reference.url || '',
  bibliographicFields: bibliographicFieldsFromReference(reference),
  format: referenceFileType(reference),
  fileType: referenceFileType(reference).toUpperCase() || '—',
  filename: String(reference.source?.originalFilename || reference.title),
  dateAdded: reference.createdAt || '',
  sizeBytes: Number((reference.artifacts || []).find((artifact:any) => artifact.kind === 'original')?.sizeBytes || 0),
  libraryIds: reference.libraryIds || [],
  status: referenceState(reference),
  hasOriginal: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'original'),
  hasStructure: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'structure'),
  hasText: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'markdown'),
  hasKokoroNarration: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'kokoro-audio'),
  hasChirpNarration: (reference.artifacts || []).some((artifact:any) => artifact.kind === 'chirp-audio'),
  needsOcr: referenceFileType(reference) === 'pdf' && (reference.artifacts || []).some((artifact:any) => artifact.kind === 'original')
    && (!(reference.artifacts || []).some((artifact:any) => artifact.kind === 'markdown') || Number(reference.wordCount || 0) < 20),
  access: reference.access || 'owner',
});

export function mountSeshatWorkspace(root: HTMLElement): void {
  const payload = readPayload();
  payload.keywordStyles ||= {};
  payload.smartFolders ||= [];
  payload.chirpEnabled = Boolean(payload.chirpEnabled);
  payload.references.forEach((reference) => { reference.type = normalizeBibliographicType(reference.type); });
  const references = new Map(payload.references.map((reference) => [reference.id, reference]));
  const host = root.querySelector<HTMLElement>('[data-dockview-host]');
  const tree = root.querySelector<HTMLElement>('[data-library-tree]');
  const search = root.querySelector<HTMLInputElement>('[data-tree-search]');
  const treeOrderControl = root.querySelector<HTMLSelectElement>('[data-tree-order]');
  const saveState = root.querySelector<HTMLElement>('[data-save-state]');
  type TreeOrder = 'az' | 'za' | 'recent' | 'size';
  const storedTreeOrder = window.localStorage.getItem(TREE_ORDER_KEY);
  let treeOrder: TreeOrder = storedTreeOrder === 'za' || storedTreeOrder === 'recent' || storedTreeOrder === 'size' ? storedTreeOrder : 'az';
  let lastRead: Record<string, number> = {};
  try { lastRead = JSON.parse(window.localStorage.getItem(TREE_LAST_READ_KEY) || '{}'); } catch { lastRead = {}; }
  if (treeOrderControl) treeOrderControl.value = treeOrder;
  const isPhoneLayout=()=>window.matchMedia('(max-width: 1000px) and (pointer: coarse)').matches;
  const consoleRoot = root.querySelector<HTMLElement>('[data-workspace-console]');
  const consoleCurrent = root.querySelector<HTMLElement>('[data-console-current]');
  const consoleCount = root.querySelector<HTMLElement>('[data-console-count]');
  const consoleDrawer = root.querySelector<HTMLElement>('[data-console-drawer]');
  const consoleLog = root.querySelector<HTMLOListElement>('[data-console-log]');
  const consoleToggle = root.querySelector<HTMLButtonElement>('[data-console-toggle]');
  const keywordFilter = root.querySelector<HTMLInputElement>('[data-keyword-filter]');
  const keywordCloud = root.querySelector<HTMLElement>('[data-keyword-cloud]');
  const keywordCount = root.querySelector<HTMLElement>('[data-keyword-count]');
  const propertiesContent = root.querySelector<HTMLElement>('[data-properties-content]');
  const narrationProgress=root.querySelector<HTMLElement>('[data-narration-progress]');const narrationProgressLabel=root.querySelector<HTMLElement>('[data-narration-progress-label]');const narrationProgressValue=root.querySelector<HTMLElement>('[data-narration-progress-value]');const narrationProgressBar=root.querySelector<HTMLProgressElement>('[data-narration-progress-bar]');let narrationProgressTimer=0;
  if (!host || !tree || !search || !saveState || !consoleRoot || !consoleCurrent || !consoleCount || !consoleDrawer || !consoleLog || !consoleToggle) return;

  let api: DockviewApi;
  let catalogTable: Handsontable | null = null;
  let catalogQuery = '';
  let catalogFilterStatus: HTMLElement | null = null;
  let activeLibrary: string | null = null;
  let activeSmartFolder: string | null = null;
  let activeVirtualFolder: 'duplicates' | null = null;
  let activeKeyword: string | null = null;
  let activeReference: string | null = payload.references[0]?.id || null;
  let previewRender: ((referenceId: string) => void) | null = null;
  const documentDisposers = new WeakMap<HTMLElement, () => void>();
  const selectedReferences = new Set<string>();
  let treeSelectionAnchor: string | null = null;
  let treeRevealReferenceId: string | null = null;
  let altLocateArmed = false;
  const committed = new Map(payload.references.map((reference) => [reference.id, { ...reference }]));
  const saveTimers = new Map<string, number>();
  const activities: Activity[] = [];
  const bibliographyFiles = new Map<string, File[]>();
  const collapsedLibraries = new Set<string>(JSON.parse(window.localStorage.getItem(TREE_STATE_KEY) || '[]'));
  let shortcutPrefix = ''; let shortcutPrefixTimer = 0;
  let quickfinder: HTMLElement | null = null;

  const syncTreeSelection = () => {
    tree.querySelectorAll<HTMLElement>('.tree-reference.selected').forEach((item) => item.classList.remove('selected'));
    selectedReferences.forEach((id) => {
      tree.querySelectorAll<HTMLElement>(`.tree-reference[data-reference-id="${CSS.escape(id)}"]`).forEach((item) => item.classList.add('selected'));
    });
  };

  const duplicateFingerprint = (reference: ReferenceRow) => potentialDuplicateFingerprint({
    title: reference.title,
    issued: parsePublicationYear(reference.year) === undefined ? undefined : { year: parsePublicationYear(reference.year) },
    contributors: reference.contributors,
    identifiers: {
      doi: reference.bibliographicFields.doi || undefined,
      isbn: reference.isbn.split(/[;,\n]+/).map((value) => value.trim()).filter(Boolean),
    },
  });
  const duplicateSnapshot = () => {
    const candidates = new Map<string,ReferenceRow[]>();
    payload.references.filter((reference) => reference.access === 'owner').forEach((reference) => {
      const fingerprint = duplicateFingerprint(reference); if (!fingerprint) return;
      candidates.set(fingerprint,[...(candidates.get(fingerprint)||[]),reference]);
    });
    const groups = [...candidates.entries()].filter(([,rows]) => rows.length > 1)
      .sort((left,right) => normalize(left[1][0]?.title).localeCompare(normalize(right[1][0]?.title)));
    const fingerprints = new Map<string,string>();
    groups.forEach(([fingerprint,rows]) => rows.forEach((row) => fingerprints.set(row.id,fingerprint)));
    return { groups, fingerprints, ids:new Set(fingerprints.keys()) };
  };
  const computeFilteredRows = () => {
    const query = normalize(catalogQuery);
    const smartFolder = activeSmartFolder ? payload.smartFolders.find((folder) => folder.id === activeSmartFolder) : undefined;
    let rows = payload.references.filter((reference) => (!activeLibrary
      || (isInboxLibraryId(activeLibrary) ? isUnfiledReference(reference) : reference.libraryIds.includes(activeLibrary)))
      && (!smartFolder || referenceMatchesSmartFolder(reference, smartFolder.filters))
      && (!activeKeyword || reference.keywords.includes(activeKeyword))
      && (!query || [reference.title, reference.contributorsDisplay, reference.citeKey, reference.tags, reference.publisher, reference.filename, reference.status]
        .some((value) => normalize(value).includes(query))));
    if (activeVirtualFolder === 'duplicates') {
      const snapshot = duplicateSnapshot();
      rows = rows.filter((reference) => snapshot.ids.has(reference.id)).sort((left,right) => {
        const leftKey=snapshot.fingerprints.get(left.id)||'',rightKey=snapshot.fingerprints.get(right.id)||'';
        return leftKey.localeCompare(rightKey)||normalize(left.title).localeCompare(normalize(right.title))||left.id.localeCompare(right.id);
      });
    }
    return rows;
  };
  // Handsontable invokes renderers and `cells()` many times. Keep the current
  // projection stable so a single cell render never scans the entire catalog.
  let visibleCatalogRows = computeFilteredRows();
  const filteredRows = () => visibleCatalogRows;
  const setOpenDragData = (transfer: DataTransfer | null, ids: string[]) => {
    if (!transfer || !ids.length) return; transfer.effectAllowed='copyMove'; transfer.setData('application/x-seshat-open-references',JSON.stringify([...new Set(ids)])); transfer.setData('text/plain',ids[0]);
  };
  const refreshTable = () => {
    visibleCatalogRows = computeFilteredRows();
    catalogTable?.loadData(visibleCatalogRows);
    if (catalogFilterStatus) {
      const groups=activeVirtualFolder==='duplicates'?duplicateSnapshot().groups.length:0;
      catalogFilterStatus.textContent = activeVirtualFolder==='duplicates'
        ? `${visibleCatalogRows.length} duplicate items · ${groups} groups`
        : `${visibleCatalogRows.length} / ${payload.references.length}`;
    }
  };

  const setSaveState = (state: string, tone: 'ready' | 'saving' | 'error' = 'ready') => {
    saveState.textContent = state;
    saveState.dataset.tone = tone;
  };
  const setNarrationProgress=(label:string,progress:number,state:'working'|'complete'|'error'='working')=>{if(!narrationProgress||!narrationProgressLabel||!narrationProgressValue||!narrationProgressBar)return;window.clearTimeout(narrationProgressTimer);const value=Math.max(0,Math.min(100,Math.round(progress)));narrationProgress.hidden=false;narrationProgress.dataset.state=state;narrationProgressLabel.textContent=label;narrationProgressValue.textContent=state==='error'?'Error':`${value}%`;narrationProgressBar.value=value;if(state!=='working')narrationProgressTimer=window.setTimeout(()=>{narrationProgress.hidden=true;},state==='complete'?3500:7000);};
  const PROCESSING_DONE_STATES = new Set(['ready', 'failed', 'missing file', 'no extracted text']);
  const processingReferences = new Set<string>();
  const setProcessing = (referenceId: string, busy: boolean) => {
    if (busy === processingReferences.has(referenceId)) return;
    if (busy) processingReferences.add(referenceId); else processingReferences.delete(referenceId);
    renderTree(search.value);
    if (processingReferences.size > 0) setSaveState(`processing ${processingReferences.size} item${processingReferences.size === 1 ? '' : 's'}…`, 'saving');
    else setSaveState('ready');
  };
  const isProcessingReference = (reference: ReferenceRow) => processingReferences.has(reference.id)
    || Boolean((reference as any).status && !PROCESSING_DONE_STATES.has(String((reference as any).status)));

  const dialogShell = (title: string) => {
    const dialog = document.createElement('dialog'); dialog.className = 'seshat-dialog';
    const header = document.createElement('header');
    const heading = document.createElement('h2'); heading.textContent = title;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'dialog-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => dialog.close()); header.append(heading, close); dialog.appendChild(header);
    dialog.addEventListener('close', () => dialog.remove());
    const parentContainer = document.fullscreenElement || document.querySelector('.maximized-pod') || root;
    parentContainer.appendChild(dialog);
    dialog.showModal();
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
    form.set('bibliographicFields', JSON.stringify(row.bibliographicFields));
    const response = await fetch(`/api/library/${row.id}/metadata`, { method: 'POST', body: form });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Save failed');
    invalidateMetadataSuggestions();
    committed.set(row.id, { ...row });
    if (result.storageRename?.ok === false) {
      setSaveState(result.storageRename.warning || 'saved; Wasabi filename unchanged', 'error');
    } else {
      setSaveState(result.storageRename?.to ? 'saved · Wasabi file renamed' : 'saved', 'ready');
      window.setTimeout(() => setSaveState('ready'), 1500);
    }
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
  const toBetterBibtex = (rows: ReferenceRow[]) => rows.map((row) => {
    const byRole = (role: Contributor['role']) => row.contributors.filter((person) => person.role === role)
      .map((person) => person.literal || [person.family, person.given].filter(Boolean).join(', ')).filter(Boolean).join(' and ');
    const composer = byRole('composer');
    const author = row.type === 'score' ? composer || byRole('author') : byRole('author');
    const personFields=CONTRIBUTOR_ROLES.filter((role)=>!['author','composer','contributor'].includes(role)).map((role)=>[role,byRole(role)] as [string,string]);
    const fields: Array<[string, string]> = [...Object.entries(row.bibliographicFields),
      ['title', row.title],
      ['author', author],
      ...personFields,
      ['composer', composer],
      ['year', String(row.year || '')],
      ['publisher', row.publisher],
      ['location', row.publisherPlace],
      ['howpublished', row.type === 'score' ? 'Musical score' : ''],
      ['isbn', row.isbn],
      ['url', row.url],
      ['language', row.language],
      ['abstract', row.abstract],
      ['keywords', row.tags],
    ].filter((field): field is [string, string] => Boolean(field[1]?.trim()));
    const uniqueFields=[...new Map(fields.map(([key,value])=>[key,[key,value] as [string,string]])).values()];
    const body = uniqueFields.map(([key, value]) => `  ${key} = {${bibtexEscape(value)}}`).join(',\n');
    return `@${biblatexEntryTypeFor(row.type)}{${row.citeKey || row.id},\n${body}\n}`;
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
  const runReferenceAction = async (ids: string[], action: 'reprocess-metadata' | 'scholarly' | 'summarize' | 'extract' | 'relate' | 'refresh-graph') => {
    let label = 'AI summary';
    let message = 'Preparing AI summary';
    if (action === 'reprocess-metadata') { label = 'metadata re-processing'; message = 'Identifying title, author, year and publisher'; }
    else if (action === 'scholarly') { label = 'OpenAlex enrichment'; message = 'Resolving scholarly metadata and associations'; }
    else if (action === 'refresh-graph') { label = 'graph refresh'; message = 'Reprocessing OpenAlex data and rebuilding the knowledge graph'; }
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
  const removeReferencesFromCollection = async (ids: string[], requestedCollectionId: string | null = activeLibrary) => {
    if (!requestedCollectionId || isInboxLibraryId(requestedCollectionId)) return;
    const collectionId = requestedCollectionId;
    setSaveState('removing from collection…', 'saving');
    let removed = 0;
    for (const id of ids) {
      const response = await fetch(`/api/library/${encodeURIComponent(id)}/libraries?libraryId=${encodeURIComponent(collectionId)}`, { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setSaveState(result.error || 'Could not remove item from collection', 'error'); continue; }
      const reference = references.get(id);
      if (reference) reference.libraryIds = Array.isArray(result.libraryIds) ? result.libraryIds : reference.libraryIds.filter((libraryId) => libraryId !== collectionId);
      removed += 1;
    }
    selectedReferences.clear(); refreshTable(); renderTree(search.value);
    setSaveState(`${removed} ${removed === 1 ? 'item' : 'items'} removed from collection`);
  };
  const openKokoroNarration = (reference: ReferenceRow) => {
    const dialog=dialogShell(`Kokoro narration · ${reference.title}`);const form=document.createElement('form');form.className='dialog-form';
    const languageLabel=document.createElement('label');languageLabel.textContent='Language';const language=document.createElement('select');
    [['es','Spanish'],['en','English']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=normalizeReaderLanguage(reference.language||navigator.language)===value;language.appendChild(option);});languageLabel.appendChild(language);
    const voiceLabel=document.createElement('label');voiceLabel.textContent='Voice';const voice=document.createElement('select');voiceLabel.appendChild(voice);
    const renderVoices=()=>{voice.replaceChildren();const code=language.value;KOKORO_VOICES.filter((item)=>code==='es'?item.id.startsWith('e'):!item.id.startsWith('e')).forEach((item)=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;voice.appendChild(option);});};language.onchange=renderVoices;renderVoices();
    const note=document.createElement('p');note.textContent='Creates cached OGG/Opus segments in Wasabi. Keep this workspace open until rendering finishes.';
    const footer=document.createElement('footer');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>dialog.close();const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent='Render narration';footer.append(cancel,submit);form.append(languageLabel,voiceLabel,note,footer);dialog.appendChild(form);
    form.onsubmit=(event)=>{event.preventDefault();const selectedLanguage=language.value,selectedVoice=voice.value;dialog.close();const activityId=`kokoro-narration-${reference.id}`;updateActivity(activityId,{state:'working',referenceId:reference.id,message:`${reference.title} · preparing Kokoro narration`});setNarrationProgress(`Kokoro · ${reference.title}`,0);setSaveState('rendering Kokoro narration…','saving');void readAloud.renderNarration(reference.id,selectedLanguage,selectedVoice,(message,progress)=>{updateActivity(activityId,{state:'working',referenceId:reference.id,message:`${reference.title} · ${message}`});setNarrationProgress(`Kokoro · ${reference.title}`,progress??0);setSaveState(message,'saving');}).then((segments)=>{reference.hasKokoroNarration=true;renderTree(search.value);updateActivity(activityId,{state:'complete',referenceId:reference.id,message:`${reference.title} · ${segments} OGG ${segments===1?'segment':'segments'} ready`});setNarrationProgress(`Kokoro · ${reference.title}`,100,'complete');setSaveState('Kokoro narration ready');}).catch((error)=>{const message=error instanceof Error?error.message:'Narration failed';updateActivity(activityId,{state:'error',referenceId:reference.id,message:`${reference.title} · ${message}`});setNarrationProgress(`Kokoro · ${message}`,0,'error');setSaveState(message,'error');});};
  };
  const eraseKokoroNarrations = async (ids:string[]) => {
    setSaveState('erasing Kokoro narration…','saving');let erased=0;
    for(const id of ids){const response=await fetch(`/api/library/${encodeURIComponent(id)}/narration`,{method:'DELETE'});const result=await response.json().catch(()=>({}));if(!response.ok){setSaveState(result.error||'Narration could not be erased','error');continue;}const reference=references.get(id);if(reference)reference.hasKokoroNarration=false;erased+=1;}
    renderTree(search.value);setSaveState(`${erased} Kokoro ${erased===1?'narration':'narrations'} erased`);
  };
  const openChirpNarration = (reference:ReferenceRow) => {
    const dialog=dialogShell(`Google Chirp narration · ${reference.title}`),form=document.createElement('form');form.className='dialog-form';
    const languageLabel=document.createElement('label');languageLabel.textContent='Language';const language=document.createElement('select');
    [['es','Spanish'],['en','English']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;option.selected=normalizeReaderLanguage(reference.language||navigator.language)===value;language.appendChild(option);});languageLabel.appendChild(language);
    const voiceLabel=document.createElement('label');voiceLabel.textContent='Voice';const voice=document.createElement('select');voiceLabel.appendChild(voice);
    const note=document.createElement('p');note.textContent='Checking the monthly Google Chirp balance…';
    const footer=document.createElement('footer');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>dialog.close();const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent='Render narration';submit.disabled=true;footer.append(cancel,submit);form.append(languageLabel,voiceLabel,note,footer);dialog.appendChild(form);
    let source='',status:any=null;
    const renderVoices=()=>{voice.replaceChildren();CHIRP_VOICES.filter((item)=>item.language===language.value).forEach((item)=>{const option=document.createElement('option');option.value=item.id;option.textContent=item.label;voice.appendChild(option);});if(status&&source){const required=narrationCharacterCount(source,language.value),remaining=Number(status.remaining||0);note.textContent=`This render uses about ${required.toLocaleString()} characters · ${remaining.toLocaleString()} remain · renews ${new Date(status.renewsAt).toLocaleDateString()}.`;submit.disabled=!status.configured||required>remaining;}};
    language.onchange=renderVoices;renderVoices();
    void Promise.all([fetch(`/api/library/${encodeURIComponent(reference.id)}/artifact/markdown`,{cache:'no-store'}),fetch(`/api/library/${encodeURIComponent(reference.id)}/chirp`,{cache:'no-store'})]).then(async([textResponse,statusResponse])=>{if(!textResponse.ok)throw new Error('Extracted text is required before rendering narration.');source=await textResponse.text();status=await statusResponse.json();if(!statusResponse.ok||!status.configured)throw new Error(status.error||'Google Chirp is not configured.');renderVoices();}).catch((error)=>{note.textContent=error instanceof Error?error.message:'Google Chirp status is unavailable.';submit.disabled=true;});
    form.onsubmit=(event)=>{event.preventDefault();const selectedLanguage=language.value,selectedVoice=voice.value;dialog.close();const activityId=`chirp-narration-${reference.id}`;updateActivity(activityId,{state:'working',referenceId:reference.id,message:`${reference.title} · preparing Google Chirp narration`});setNarrationProgress(`Google Chirp · ${reference.title}`,0);setSaveState('rendering Google Chirp narration…','saving');void readAloud.renderChirpNarration(reference.id,selectedLanguage,selectedVoice,(message,progress)=>{updateActivity(activityId,{state:'working',referenceId:reference.id,message:`${reference.title} · ${message}`});setNarrationProgress(`Google Chirp · ${reference.title}`,progress??0);setSaveState(message,'saving');}).then((segments)=>{reference.hasChirpNarration=true;renderTree(search.value);updateActivity(activityId,{state:'complete',referenceId:reference.id,message:`${reference.title} · ${segments} Chirp OGG ${segments===1?'segment':'segments'} ready`});setNarrationProgress(`Google Chirp · ${reference.title}`,100,'complete');setSaveState('Google Chirp narration ready');}).catch((error)=>{const message=error instanceof Error?error.message:'Chirp narration failed';updateActivity(activityId,{state:'error',referenceId:reference.id,message:`${reference.title} · ${message}`});setNarrationProgress(`Google Chirp · ${message}`,0,'error');setSaveState(message,'error');});};
  };
  const eraseChirpNarrations = async (ids:string[]) => {
    setSaveState('erasing Google Chirp narration…','saving');let erased=0;
    for(const id of ids){const response=await fetch(`/api/library/${encodeURIComponent(id)}/narration?provider=chirp`,{method:'DELETE'});const result=await response.json().catch(()=>({}));if(!response.ok){setSaveState(result.error||'Chirp narration could not be erased','error');continue;}const reference=references.get(id);if(reference)reference.hasChirpNarration=false;erased+=1;}
    renderTree(search.value);setSaveState(`${erased} Google Chirp ${erased===1?'narration':'narrations'} erased`);
  };
  type WasabiCandidate = { key:string; filename:string; path:string; sizeBytes:number; score:number };
  type WasabiCandidateSearch = { candidates:WasabiCandidate[]; expected?:string; scanned:number };
  const findWasabiCandidates = async (referenceId:string):Promise<WasabiCandidateSearch> => {
    const response = await fetch(`/api/library/${referenceId}/candidates`, { cache:'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Candidate search failed');
    return { candidates:Array.isArray(result.candidates) ? result.candidates : [], expected:result.expected, scanned:Number(result.scanned || 0) };
  };
  const linkWasabiCandidate = async (referenceId:string,candidate:WasabiCandidate,options:{deferRender?:boolean;follow?:boolean}={}) => {
    const linked = await fetch(`/api/library/${referenceId}/candidates`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ key:candidate.key }) });
    const linkedResult = await linked.json().catch(() => ({}));
    if (!linked.ok) throw new Error(linkedResult.error || 'Candidate could not be linked.');
    const next = rowFromCatalogReference(linkedResult.reference);
    if (options.deferRender) {
      const current=references.get(next.id);if(current)Object.assign(current,next);else{payload.references.unshift(next);references.set(next.id,next);}committed.set(next.id,{...(references.get(next.id) as ReferenceRow)});
    } else upsertRow(next);
    updateActivity(`candidate-${referenceId}`, { state:options.follow===false?'complete':'working', referenceId, message:options.follow===false?`${candidate.filename} · linked; extraction queued`:`${candidate.filename} · linked; extracting text and structure` });
    if(options.follow!==false)void followPipeline(referenceId, `candidate-${referenceId}`, candidate.filename);
    return next;
  };
  const searchForCandidate = async (referenceId: string) => {
    const reference = references.get(referenceId); if (!reference) return;
    const dialog = dialogShell(`Search candidate · ${reference.title}`); dialog.classList.add('candidate-dialog');
    const body = document.createElement('div'); body.className = 'candidate-search';
    const status = document.createElement('p'); status.textContent = 'Searching your Wasabi root…'; body.appendChild(status); dialog.appendChild(body);
    setSaveState('searching Wasabi candidates…', 'saving');
    try {
      const result = await findWasabiCandidates(referenceId);
      status.textContent = result.expected ? `Expected: ${result.expected} · ${result.scanned} objects inspected` : `${result.scanned} objects inspected`;
      const list = document.createElement('div'); list.className = 'candidate-list'; body.appendChild(list);
      if (!result.candidates?.length) { const empty = document.createElement('p'); empty.className = 'candidate-empty'; empty.textContent = 'No plausible PDF, EPUB, DOCX or TXT candidate was found.'; list.appendChild(empty); }
      for (const candidate of result.candidates || []) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'candidate-option';
        const score = document.createElement('i'); score.textContent = String(candidate.score);
        const copy = document.createElement('span'); const name = document.createElement('strong'); name.textContent = candidate.filename;
        const path = document.createElement('small'); path.textContent = `${candidate.path} · ${Math.max(1, Math.round(candidate.sizeBytes / 1024))} KB`; copy.append(name,path); row.append(score,copy);
        row.addEventListener('click', async () => {
          row.disabled = true; status.textContent = `Linking ${candidate.filename}…`;
          try { await linkWasabiCandidate(referenceId,candidate);dialog.close();setSaveState('candidate linked; extraction queued'); }
          catch(error){row.disabled=false;status.textContent=error instanceof Error?error.message:'Candidate could not be linked.';}
        });
        list.appendChild(row);
      }
      setSaveState(`${result.candidates?.length || 0} candidate${result.candidates?.length === 1 ? '' : 's'} found`);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Candidate search failed'; setSaveState(status.textContent, 'error');
    }
  };
  const searchWasabiForSelection = async (ids:string[],autoSelectFirst:boolean) => {
    const editableIds=[...new Set(ids)].filter((id)=>references.get(id)?.access!=='viewer');
    if(!editableIds.length){setSaveState('select at least one editable item','error');return;}
    if(!autoSelectFirst&&editableIds.length===1){await searchForCandidate(editableIds[0]);return;}
    if(autoSelectFirst){
      let linked=0,missing=0,failed=0;setSaveState(`searching Wasabi for ${editableIds.length} items…`,'saving');
      for(let index=0;index<editableIds.length;index+=1){const id=editableIds[index];const reference=references.get(id);setSaveState(`Wasabi ${index+1}/${editableIds.length} · ${reference?.title||id}`,'saving');try{const result=await findWasabiCandidates(id);const candidate=result.candidates[0];if(!candidate){missing+=1;continue;}await linkWasabiCandidate(id,candidate,{deferRender:true,follow:false});linked+=1;}catch{failed+=1;}}
      refreshTable();renderTree(search.value);setSaveState(`${linked} linked automatically · ${missing} without match${failed?` · ${failed} failed`:''}`,failed?'error':'ready');return;
    }
    const dialog=dialogShell(`Wasabi candidates · ${editableIds.length} selected items`);dialog.classList.add('candidate-dialog');const body=document.createElement('div');body.className='candidate-search';const summary=document.createElement('p');summary.textContent='Searching selected items in Wasabi…';body.appendChild(summary);dialog.appendChild(body);let found=0;
    for(let index=0;index<editableIds.length;index+=1){const id=editableIds[index],reference=references.get(id);summary.textContent=`Searching ${index+1} / ${editableIds.length}…`;const section=document.createElement('section');section.className='candidate-batch-item';const heading=document.createElement('h3');heading.textContent=reference?.title||id;const list=document.createElement('div');list.className='candidate-list';section.append(heading,list);body.appendChild(section);try{const result=await findWasabiCandidates(id);const candidates=result.candidates.slice(0,5);found+=candidates.length;if(!candidates.length){const empty=document.createElement('p');empty.className='candidate-empty';empty.textContent='No plausible candidate found.';list.appendChild(empty);continue;}candidates.forEach((candidate)=>{const row=document.createElement('button');row.type='button';row.className='candidate-option';const score=document.createElement('i');score.textContent=String(candidate.score);const copy=document.createElement('span');const name=document.createElement('strong');name.textContent=candidate.filename;const path=document.createElement('small');path.textContent=candidate.path;copy.append(name,path);row.append(score,copy);row.addEventListener('click',async()=>{list.querySelectorAll<HTMLButtonElement>('button').forEach((button)=>button.disabled=true);try{await linkWasabiCandidate(id,candidate);section.dataset.linked='true';heading.textContent=`${reference?.title||id} · linked`;setSaveState('candidate linked; extraction queued');}catch(error){list.querySelectorAll<HTMLButtonElement>('button').forEach((button)=>button.disabled=false);setSaveState(error instanceof Error?error.message:'Candidate could not be linked.','error');}});list.appendChild(row);});}catch(error){const failed=document.createElement('p');failed.className='candidate-empty';failed.textContent=error instanceof Error?error.message:'Candidate search failed';list.appendChild(failed);}}
    summary.textContent=`${found} candidates across ${editableIds.length} selected items`;setSaveState(`${found} candidates found`);
  };
  const duplicateGroupFor = (ids:string[]) => {
    const snapshot=duplicateSnapshot();
    const mapped=ids.map((id)=>snapshot.fingerprints.get(id));
    if(mapped.some((value)=>!value))return [];
    const selectedFingerprints=[...new Set(mapped.filter((value):value is string=>Boolean(value)))];
    if(selectedFingerprints.length!==1)return [];
    const first=selectedFingerprints[0];
    if(!first)return [];
    return snapshot.groups.find(([fingerprint])=>fingerprint===first)?.[1]||[];
  };
  const duplicateRecordScore = (reference:ReferenceRow) =>
    (reference.hasOriginal?100:0)+(reference.hasText?30:0)+(reference.hasStructure?15:0)
    +[reference.title,reference.contributorsDisplay,reference.year,reference.publisher,reference.abstract,reference.language,reference.url,reference.isbn].filter(Boolean).length
    +reference.libraryIds.length;
  const openDuplicateMerge = (ids:string[]) => {
    const group=duplicateGroupFor(ids);
    if(group.length<2){setSaveState('select an item from one duplicate group','error');return;}
    const suggested=[...group].sort((left,right)=>duplicateRecordScore(right)-duplicateRecordScore(left))[0];
    const dialog=dialogShell(`Merge duplicate group · ${group.length} items`);dialog.classList.add('duplicate-merge-dialog');
    const form=document.createElement('form');form.className='duplicate-merge-form';
    const intro=document.createElement('p');intro.textContent='Choose the surviving catalog record. Seshat combines metadata, collections and notes; every distinct stored original remains attached as an alternate file.';
    const list=document.createElement('div');list.className='duplicate-merge-list';
    group.forEach((reference)=>{
      const option=document.createElement('label');option.className='duplicate-merge-option';
      const input=document.createElement('input');input.type='radio';input.name='duplicate-survivor';input.value=reference.id;input.checked=reference.id===suggested.id;
      const copy=document.createElement('span');const title=document.createElement('strong');title.textContent=reference.title||'Untitled';
      const details=document.createElement('small');details.textContent=[reference.contributorsDisplay,reference.year,reference.type,reference.hasOriginal?reference.filename:'no associated file',`${reference.libraryIds.length} collection${reference.libraryIds.length===1?'':'s'}`].filter(Boolean).join(' · ');
      copy.append(title,details);option.append(input,copy);list.appendChild(option);
    });
    const note=document.createElement('p');note.className='duplicate-merge-note';note.textContent='The other catalog entries disappear after the transaction. Alternate originals are preserved in Wasabi and will be deleted only if the surviving item is later deleted explicitly.';
    const footer=document.createElement('footer');const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>dialog.close();const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent=`Merge ${group.length} items`;footer.append(cancel,submit);
    form.append(intro,list,note,footer);dialog.appendChild(form);
    form.onsubmit=(event)=>{event.preventDefault();const keepId=new FormData(form).get('duplicate-survivor')?.toString()||'';if(!keepId)return;submit.disabled=true;cancel.disabled=true;setSaveState('merging duplicate group…','saving');void fetch('/api/library/merge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({keepId,duplicateIds:group.filter((reference)=>reference.id!==keepId).map((reference)=>reference.id)})}).then(async(response)=>{const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Duplicate merge failed');for(const removedId of result.removedIds||[]){api.panels.filter((item)=>item.id.includes(removedId)).forEach((item)=>item.api.close());references.delete(removedId);committed.delete(removedId);selectedReferences.delete(removedId);const index=payload.references.findIndex((item)=>item.id===removedId);if(index>=0)payload.references.splice(index,1);}const next=rowFromCatalogReference(result.reference);upsertRow(next);activeReference=next.id;selectedReferences.clear();selectedReferences.add(next.id);dialog.close();refreshTable();renderTree(search.value);renderProperties(next.id);setSaveState(`${group.length} duplicates merged · files preserved`);}).catch((error)=>{submit.disabled=false;cancel.disabled=false;setSaveState(error instanceof Error?error.message:'Duplicate merge failed','error');});};
  };
  const deleteDuplicateSelection = async (ids:string[]) => {
    const editable=[...new Set(ids)].filter((id)=>references.get(id)?.access==='owner');if(!editable.length)return;
    const confirmed=await confirmAction('Delete duplicate items',`Permanently delete ${editable.length} selected ${editable.length===1?'item':'items'} and every stored file attached to them?`,'Delete items and files');
    if(confirmed)await deleteReferences(editable);
  };
  const referenceMenuItems = (ids: string[], requestedCollectionId: string | null = activeLibrary) => {
    const editableIds = ids.filter((id) => references.get(id)?.access !== 'viewer');
    const collection = requestedCollectionId ? payload.libraries.find((item) => item.id === requestedCollectionId) : undefined;
    const removableIds = requestedCollectionId && !isInboxLibraryId(requestedCollectionId) && collection?.access !== 'viewer'
      ? editableIds.filter((id) => references.get(id)?.libraryIds.includes(requestedCollectionId)) : [];
    return [
    { label: `Merge duplicate group…`, disabled: duplicateGroupFor(editableIds).length < 2, action: () => openDuplicateMerge(editableIds) },
    { label: 'Edit persons and roles…', disabled: editableIds.length !== 1 || ids.length !== 1, action: () => { const row = references.get(editableIds[0]); if (row) openContributorEditor(row); } },
    { label: `Copy APA citation${ids.length > 1 ? `s (${ids.length})` : ''}`, shortcut:'A', action: () => copyReferences(ids, 'apa') },
    { label: `Copy Better BibTeX${ids.length > 1 ? ` (${ids.length})` : ''}`, shortcut:'B', action: () => copyReferences(ids, 'bibtex') },
    { label: 'Upload associated file…', disabled: editableIds.length !== 1 || ids.length !== 1, action: () => pickAssociatedFile(editableIds[0]) },
    { label: `Search for candidates in Wasabi${editableIds.length > 1 ? ` (${editableIds.length})` : ''}…`, shortcut:'W', disabled: !editableIds.length, action: () => searchWasabiForSelection(editableIds,false) },
    { label: `Link first Wasabi match${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, shortcut:'⇧W', disabled: !editableIds.length, action: () => searchWasabiForSelection(editableIds,true) },
    { label: 'Render Kokoro narration…', disabled: editableIds.length !== 1 || ids.length !== 1 || !references.get(editableIds[0])?.hasText, action: () => { const row=references.get(editableIds[0]);if(row)openKokoroNarration(row); } },
    { label: `Erase Kokoro narration${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.some((id)=>references.get(id)?.hasKokoroNarration), danger: true, action: () => eraseKokoroNarrations(editableIds.filter((id)=>references.get(id)?.hasKokoroNarration)) },
    ...(payload.chirpEnabled ? [
      { label: 'Render Google Chirp narration…', disabled: editableIds.length !== 1 || ids.length !== 1 || !references.get(editableIds[0])?.hasText, action: () => { const row=references.get(editableIds[0]);if(row)openChirpNarration(row); } },
      { label: `Erase Google Chirp narration${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.some((id)=>references.get(id)?.hasChirpNarration), danger: true, action: () => eraseChirpNarrations(editableIds.filter((id)=>references.get(id)?.hasChirpNarration)) },
    ] : []),
    { label: `Extract text & structure${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'extract') },
    { label: `Re-process metadata${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'reprocess-metadata') },
    { label: `Enrich papers with OpenAlex${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'scholarly') },
    { label: `Refresh graph (OpenAlex)${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'refresh-graph') },
    { label: `AI summarize${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'summarize') },
    { label: `Extract entities & relationships${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, action: () => runReferenceAction(editableIds, 'relate') },
    { label: `Remove from collection${removableIds.length > 1 ? ` (${removableIds.length})` : ''}`, disabled: !removableIds.length, action: () => removeReferencesFromCollection(removableIds,requestedCollectionId) },
    { label: `Delete item and files${editableIds.length > 1 ? ` (${editableIds.length})` : ''}`, disabled: !editableIds.length, danger: true, action: () => activeVirtualFolder==='duplicates'?deleteDuplicateSelection(editableIds):deleteReferences(editableIds) },
    ];
  };

  type MetadataSuggestion<T> = { label: string; detail?: string; value: T };
  let metadataSuggestionSequence = 0;
  const valueSuggestionCache = new Map<string,MetadataSuggestion<string>[]>();
  let contributorSuggestionCache:MetadataSuggestion<Contributor>[]|null=null;
  const invalidateMetadataSuggestions=()=>{valueSuggestionCache.clear();contributorSuggestionCache=null;};
  const attachMetadataSuggestions = <T>(input: HTMLInputElement, host: HTMLElement, getSuggestions: () => MetadataSuggestion<T>[], onSelect: (value: T) => void) => {
    const list = document.createElement('div'); list.className = 'metadata-suggestions'; list.hidden = true; list.id = `metadata-suggestions-${++metadataSuggestionSequence}`; list.setAttribute('role', 'listbox');
    host.classList.add('metadata-autocomplete'); host.appendChild(list);
    input.autocomplete = 'off'; input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
    let activeIndex = -1;
    let visible: MetadataSuggestion<T>[] = [];
    const close = () => { visible = []; activeIndex = -1; list.hidden = true; list.replaceChildren(); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
    const choose = (index: number) => {
      const suggestion = visible[index]; if (!suggestion) return;
      onSelect(suggestion.value); close(); input.focus();
    };
    const paintActive = () => {
      [...list.children].forEach((child, index) => child.classList.toggle('active', index === activeIndex));
      const active = activeIndex >= 0 ? list.children[activeIndex] as HTMLElement | undefined : undefined;
      if (active) input.setAttribute('aria-activedescendant', active.id); else input.removeAttribute('aria-activedescendant');
    };
    const render = () => {
      const query = normalize(input.value); if (!query) { close(); return; }
      visible = getSuggestions().filter((suggestion) => normalize(`${suggestion.label} ${suggestion.detail || ''}`).includes(query))
        .sort((left, right) => Number(normalize(right.label).startsWith(query)) - Number(normalize(left.label).startsWith(query)) || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
        .slice(0, 8);
      list.replaceChildren(); activeIndex = visible.length ? 0 : -1;
      visible.forEach((suggestion, index) => {
        const option = document.createElement('button'); option.type = 'button'; option.id = `${list.id}-${index}`; option.setAttribute('role', 'option'); option.className = 'metadata-suggestion';
        const label = document.createElement('span'); label.textContent = suggestion.label; option.appendChild(label);
        if (suggestion.detail) { const detail = document.createElement('small'); detail.textContent = suggestion.detail; option.appendChild(detail); }
        option.addEventListener('pointerdown', (event) => { event.preventDefault(); choose(index); }); list.appendChild(option);
      });
      list.hidden = !visible.length; input.setAttribute('aria-expanded', String(Boolean(visible.length))); paintActive();
    };
    input.addEventListener('input', render);
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (event) => {
      if (list.hidden || !visible.length) { if (event.key === 'Escape') close(); return; }
      if (event.key === 'ArrowDown') { event.preventDefault(); activeIndex = (activeIndex + 1) % visible.length; paintActive(); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); activeIndex = (activeIndex - 1 + visible.length) % visible.length; paintActive(); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(Math.max(0, activeIndex)); }
      else if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
    input.addEventListener('blur', () => window.setTimeout(close, 90));
  };

  const valueSuggestions = (key: string): MetadataSuggestion<string>[] => {
    const cached=valueSuggestionCache.get(key);if(cached)return cached;
    const values: string[] = [];
    payload.references.forEach((reference) => {
      if (key === 'publisher') values.push(reference.publisher);
      else if (key === 'publisherPlace' || key === 'place') values.push(reference.publisherPlace, reference.bibliographicFields.location, reference.bibliographicFields.venue);
      else if (key === 'language') values.push(reference.language, reference.bibliographicFields.language);
      else if (key === 'publication') values.push(reference.bibliographicFields.journaltitle, reference.bibliographicFields.booktitle, reference.bibliographicFields.maintitle, reference.bibliographicFields.eventtitle);
      else values.push(reference.bibliographicFields[key]);
    });
    const counts = new Map<string, { label: string; count: number }>();
    values.filter(Boolean).forEach((value) => { const id = normalize(value); const current = counts.get(id); if (current) current.count += 1; else counts.set(id, { label: String(value).trim(), count: 1 }); });
    const suggestions=[...counts.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, undefined, { sensitivity: 'base' }))
      .map(({ label, count }) => ({ label, detail: count > 1 ? `${count} items` : undefined, value: label }));
    valueSuggestionCache.set(key,suggestions);return suggestions;
  };

  const contributorSuggestions = (): MetadataSuggestion<Contributor>[] => {
    if(contributorSuggestionCache)return contributorSuggestionCache;
    const people = new Map<string, { person: Contributor; count: number; roles: Set<string> }>();
    payload.references.flatMap((reference) => reference.contributors).forEach((person) => {
      const label = person.literal || [person.family, person.given].filter(Boolean).join(', '); const id = normalize(label); if (!id) return;
      const current = people.get(id); if (current) { current.count += 1; current.roles.add(person.role); }
      else people.set(id, { person: { ...person }, count: 1, roles: new Set([person.role]) });
    });
    contributorSuggestionCache=[...people.values()].sort((left, right) => right.count - left.count).map(({ person, count, roles }) => ({
      label: person.literal || [person.family, person.given].filter(Boolean).join(', '),
      detail: `${[...roles].join(' · ')}${count > 1 ? ` · ${count} items` : ''}`, value: person,
    }));return contributorSuggestionCache;
  };

  const openContributorEditor = (row: ReferenceRow) => {
    type DraftContributor = { role: Contributor['role']; family: string; given: string; literal: string };
    let draft: DraftContributor[] = row.contributors.map((person) => ({
      role: person.role || 'author', family: person.family || '', given: person.given || '', literal: person.literal || '',
    }));
    if (!draft.length) draft.push({ role: 'author', family: '', given: '', literal: '' });
    const dialog = dialogShell(`Persons · ${row.title}`); dialog.classList.add('contributor-dialog');
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
        CONTRIBUTOR_ROLES.forEach((value) => { const option = document.createElement('option'); option.value = value; option.textContent = PERSON_ROLE_LABELS[value]||value; option.selected = value === person.role; role.appendChild(option); });
        role.addEventListener('change', () => { person.role = role.value as Contributor['role']; });
        const family = document.createElement('input'); family.placeholder = 'Family'; family.value = person.family; family.setAttribute('aria-label', `Family name ${index + 1}`);
        const given = document.createElement('input'); given.placeholder = 'Given'; given.value = person.given; given.setAttribute('aria-label', `Given name ${index + 1}`);
        const literal = document.createElement('input'); literal.placeholder = 'Institution / literal'; literal.value = person.literal; literal.setAttribute('aria-label', `Literal name ${index + 1}`);
        const familyHost = document.createElement('div'); const givenHost = document.createElement('div'); const literalHost = document.createElement('div'); familyHost.appendChild(family); givenHost.appendChild(given); literalHost.appendChild(literal);
        const syncMode = () => { item.classList.toggle('is-literal', Boolean(literal.value.trim())); };
        family.addEventListener('input', () => { person.family = family.value; }); given.addEventListener('input', () => { person.given = given.value; });
        literal.addEventListener('input', () => { person.literal = literal.value; syncMode(); }); syncMode();
        const selectPerson = (selected: Contributor) => {
          person.family = selected.literal ? '' : selected.family || ''; person.given = selected.literal ? '' : selected.given || ''; person.literal = selected.literal || '';
          family.value = person.family; given.value = person.given; literal.value = person.literal; syncMode();
        };
        attachMetadataSuggestions(family, familyHost, contributorSuggestions, selectPerson);
        attachMetadataSuggestions(given, givenHost, contributorSuggestions, selectPerson);
        attachMetadataSuggestions(literal, literalHost, contributorSuggestions, selectPerson);
        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'contributor-remove'; remove.textContent = '×'; remove.title = 'Remove contributor';
        remove.addEventListener('click', () => { draft.splice(index, 1); render(); });
        item.append(handle, role, familyHost, givenHost, literalHost, remove); list.appendChild(item);
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
    const add = document.createElement('button'); add.type = 'button'; add.textContent = '+ Person';
    add.addEventListener('click', () => { draft.push({ role: 'author', family: '', given: '', literal: '' }); render(); list.lastElementChild?.scrollIntoView({ block: 'nearest' }); });
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dialog.close());
    const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary'; save.textContent = 'Save persons';
    footer.append(add, cancel, save); editor.append(guidance, list, pasteDetails, footer); dialog.appendChild(editor);
    editor.addEventListener('submit', async (event) => {
      event.preventDefault();
      const next = normalizeContributors(draft);
      const previous = row.contributors; row.contributors = next; row.contributorsDisplay = contributorSummary(next);
      refreshTable(); renderTree(search.value); save.disabled = true; save.textContent = 'Saving…';
      try { await saveReference(row); dialog.close(); }
      catch (error) {
        row.contributors = previous; row.contributorsDisplay = contributorSummary(previous); refreshTable(); renderTree(search.value);
        save.disabled = false; save.textContent = 'Save persons'; setSaveState(error instanceof Error ? error.message : 'Save failed', 'error');
      }
    });
  };

  let touchStartTimer: any = null;
  let lastTouchTime = 0;
  let touchCoords: { row: number; col: number } | null = null;
  let isLongPressEditing = false;
  let cleanupCatalogThemeListener: (() => void) | null = null;

  const mountCatalog = (element: HTMLElement) => {
    if (catalogTable || !element.isConnected) return;
    if (cleanupCatalogThemeListener) cleanupCatalogThemeListener();

    element.classList.add('ht-theme-main');
    const filterBar = document.createElement('div'); filterBar.className = 'catalog-filter-bar';
    const filter = document.createElement('input'); filter.type = 'search'; filter.autocomplete = 'off'; filter.value = catalogQuery;
    filter.placeholder = 'Live filter catalog…'; filter.setAttribute('aria-label', 'Live filter catalog');
    catalogFilterStatus = document.createElement('span');
    const tableHost = document.createElement('div'); tableHost.className = 'catalog-table-host';
    filterBar.append(filter, catalogFilterStatus); element.append(filterBar, tableHost);
    let filterTimer = 0;
    let resizeObserver: ResizeObserver | null = null;
    filter.addEventListener('input', () => {
      catalogQuery = filter.value;
      window.clearTimeout(filterTimer);
      const selectionStart=filter.selectionStart;const selectionEnd=filter.selectionEnd;
      filterTimer = window.setTimeout(()=>{refreshTable();window.requestAnimationFrame(()=>{if(!filter.isConnected)return;filter.focus({preventScroll:true});if(selectionStart!==null&&selectionEnd!==null)filter.setSelectionRange(selectionStart,selectionEnd);});},160);
    });
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    element.classList.toggle('ht-theme-main-dark-mode', isDark);

    const handleThemeChange = (e: any) => {
      element.classList.toggle('ht-theme-main-dark-mode', e.detail.theme === 'dark');
    };
    window.addEventListener('seshat:theme-changed', handleThemeChange);

    cleanupCatalogThemeListener = () => {
      window.removeEventListener('seshat:theme-changed', handleThemeChange);
      window.clearTimeout(filterTimer);
      resizeObserver?.disconnect();
      cleanupCatalogThemeListener = null;
    };

    // Touch event overrides for mobile/tablet behavior
    element.addEventListener('touchstart', (e) => {
      const cell = (e.target as HTMLElement).closest('td');
      if (!cell || !catalogTable) return;
      const coords = catalogTable.getCoords(cell as HTMLTableCellElement);
      if (!coords || coords.row < 0) return;
      touchCoords = { row: coords.row, col: coords.col };

      if (touchStartTimer) clearTimeout(touchStartTimer);
      touchStartTimer = setTimeout(() => {
        if (touchCoords && catalogTable) {
          isLongPressEditing = true;
          catalogTable.selectCell(touchCoords.row, touchCoords.col);
          const activeEditor = catalogTable.getActiveEditor();
          if (activeEditor) {
            activeEditor.beginEditing();
          }
          isLongPressEditing = false;
        }
      }, 2000);
    }, { passive: true });

    element.addEventListener('touchmove', () => {
      if (touchStartTimer) {
        clearTimeout(touchStartTimer);
        touchStartTimer = null;
      }
      touchCoords = null;
    }, { passive: true });

    element.addEventListener('touchend', (e) => {
      if (touchStartTimer) {
        clearTimeout(touchStartTimer);
        touchStartTimer = null;
      }
      const now = Date.now();
      if (now - lastTouchTime < 300) {
        const cell = (e.target as HTMLElement).closest('td');
        if (cell && catalogTable) {
          const coords = catalogTable.getCoords(cell as HTMLTableCellElement);
          if (coords && coords.row >= 0) {
            const physicalRow = catalogTable.toPhysicalRow(coords.row) ?? coords.row;
            const row = catalogTable.getSourceDataAtRow(physicalRow) as ReferenceRow | undefined;
            if (row) {
              controller.openDocument(row.id);
            }
          }
        }
        lastTouchTime = 0;
      } else {
        lastTouchTime = now;
      }
      touchCoords = null;
    }, { passive: true });

    element.addEventListener('contextmenu', (event) => {
      const header=(event.target as HTMLElement).closest('th');
      if(header&&catalogTable){const coords=catalogTable.getCoords(header as HTMLTableCellElement);if(coords?.row===-1){openCatalogHeaderMenu(event);return;}}
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
    element.addEventListener('dragstart', (event) => {
      const cell = (event.target as HTMLElement).closest('td');
      if (!cell || !catalogTable) return;
      const coords = catalogTable.getCoords(cell as HTMLTableCellElement);
      const physicalRow = coords ? catalogTable.toPhysicalRow(coords.row) : -1;
      const row = physicalRow >= 0 ? catalogTable.getSourceDataAtRow(physicalRow) as ReferenceRow : undefined;
      if (!row) { event.preventDefault(); return; }
      if (!selectedReferences.has(row.id)) { selectedReferences.clear(); selectedReferences.add(row.id); }
      setOpenDragData(event.dataTransfer,[...selectedReferences]);
    });
    const fileRenderer: BaseRenderer = (instance, td, row, column, prop, value, cellProperties) => {
      Handsontable.renderers.TextRenderer(instance, td, row, column, prop, value, cellProperties);
      const physicalRow = instance.toPhysicalRow(row);
      const item = physicalRow >= 0 ? instance.getSourceDataAtRow(physicalRow) as ReferenceRow : undefined;
      td.classList.toggle('file-needs-ocr', Boolean(item?.needsOcr));
      td.title = item?.needsOcr ? 'PDF needs OCR or usable extracted text' : item?.hasOriginal ? 'Associated file available' : 'No associated file';
    };
    const stateRenderer: BaseRenderer = (instance, td, row, column, prop, value, cellProperties) => {
      Handsontable.renderers.TextRenderer(instance, td, row, column, prop, value, cellProperties);
      td.dataset.state = String(value || '').replaceAll(' ', '-');
    };
    type CatalogColumn={key:string;group:string;column:Record<string,unknown>;defaultVisible:boolean};
    const coreColumns:CatalogColumn[]=[
      {key:'title',group:'Identity',defaultVisible:true,column:{data:'title',title:'Title',width:300}},
      {key:'persons',group:'Persons',defaultVisible:true,column:{data:'contributorsDisplay',title:'Persons',readOnly:true,className:'contributors-cell',width:260}},
      {key:'year',group:'Date',defaultVisible:true,column:{data:'year',title:'Year',type:'numeric',width:72}},
      {key:'entryType',group:'Identity',defaultVisible:true,column:{data:'type',title:'Entry type',type:'dropdown',source:[...BIBLATEX_ENTRY_TYPE_VALUES],strict:true,allowInvalid:false,width:150}},
      {key:'publisher',group:'Publication',defaultVisible:true,column:{data:'publisher',title:'Publisher',width:210}},
      {key:'location',group:'Publication',defaultVisible:true,column:{data:'publisherPlace',title:'Location',width:140}},
      {key:'url',group:'Access',defaultVisible:true,column:{data:'url',title:'URL',width:260}},
      {key:'isbn',group:'Identifiers',defaultVisible:true,column:{data:'isbn',title:'ISBN',width:150}},
      {key:'language',group:'Description',defaultVisible:true,column:{data:'language',title:'Language',width:90}},
      {key:'tags',group:'Description',defaultVisible:true,column:{data:'tags',title:'Tags',width:190}},
      {key:'citeKey',group:'Identity',defaultVisible:true,column:{data:'citeKey',title:'Citekey',width:160}},
      {key:'dateAdded',group:'System',defaultVisible:true,column:{data:'dateAdded',title:'Date added',readOnly:true,width:190}},
      {key:'abstract',group:'Description',defaultVisible:true,column:{data:'abstract',title:'Abstract',width:320}},
      {key:'fileType',group:'System',defaultVisible:true,column:{data:'fileType',title:'File',readOnly:true,renderer:fileRenderer,width:72}},
      {key:'status',group:'System',defaultVisible:true,column:{data:'status',title:'State',readOnly:true,renderer:stateRenderer,width:130}},
    ];
    const coreFieldKeys=new Set(['title','year','publisher','location','url','isbn','language','abstract']);
    const extendedColumns:CatalogColumn[]=BIBLATEX_FIELD_OPTIONS.filter((field)=>!('core' in field)&&!coreFieldKeys.has(field.key)).map((field)=>({key:`biblatex:${field.key}`,group:field.group,defaultVisible:false,column:{data:`bibliographicFields.${field.key}`,title:field.label,width:['note','annotation'].includes(field.key)?280:170}}));
    const catalogColumns=[...coreColumns,...extendedColumns];
    const visibleStorageKey='seshat.catalog.visible-columns.v1';const stickyStorageKey='seshat.catalog.sticky-columns.v1';
    const storedVisible=(()=>{try{const parsed=JSON.parse(window.localStorage.getItem(visibleStorageKey)||'null');return Array.isArray(parsed)?new Set<string>(parsed):null;}catch{return null;}})();
    const visibleColumns=storedVisible||new Set(catalogColumns.filter((item)=>item.defaultVisible).map((item)=>item.key));
    let stickyColumns=Math.max(0,Math.min(2,Number(window.localStorage.getItem(stickyStorageKey)??2)));
    const saveVisibleColumns=()=>window.localStorage.setItem(visibleStorageKey,JSON.stringify([...visibleColumns]));
    const setColumnVisible=(key:string,visible:boolean)=>{const index=catalogColumns.findIndex((item)=>item.key===key);if(index<0||!catalogTable)return;if(visible){visibleColumns.add(key);catalogTable.getPlugin('hiddenColumns').showColumn(index);}else{visibleColumns.delete(key);catalogTable.getPlugin('hiddenColumns').hideColumn(index);}saveVisibleColumns();catalogTable.render();};
    const setStickyColumns=(count:number)=>{stickyColumns=count;window.localStorage.setItem(stickyStorageKey,String(count));catalogTable?.updateSettings({fixedColumnsStart:count});setSaveState(count===2?'title and persons fixed':count===1?'title fixed':'fixed columns unlocked');};
    const openCatalogHeaderMenu=(event:MouseEvent)=>{const groups=new Map<string,CatalogColumn[]>();catalogColumns.forEach((item)=>groups.set(item.group,[...(groups.get(item.group)||[]),item]));const fieldGroups:ContextMenuItem[]=[...groups].map(([group,items])=>({label:group,children:items.map((item)=>({label:String(item.column.title||item.key),checked:visibleColumns.has(item.key),action:()=>setColumnVisible(item.key,!visibleColumns.has(item.key))}))}));openContextMenu(event,[{label:'Fields',children:fieldGroups},{label:'Sticky columns',children:[{label:'Title + Persons',checked:stickyColumns===2,action:()=>setStickyColumns(2)},{label:'Title only',checked:stickyColumns===1,action:()=>setStickyColumns(1)},{label:'Unlock both',checked:stickyColumns===0,action:()=>setStickyColumns(0)}]},{label:'Show all fields',action:()=>catalogColumns.forEach((item)=>setColumnVisible(item.key,true))},{label:'Restore default fields',action:()=>catalogColumns.forEach((item)=>setColumnVisible(item.key,item.defaultVisible))}]);};
    let tableHeight = Math.max(180, Math.floor(tableHost.getBoundingClientRect().height || element.getBoundingClientRect().height - filterBar.getBoundingClientRect().height));
    catalogTable = new Handsontable(tableHost, {
      data: filteredRows(),
      columns: catalogColumns.map((item)=>item.column),
      rowHeaders: false,
      rowHeights: 28,
      autoRowSize: false,
      autoColumnSize: false,
      columnHeaderHeight: 30,
      width: '100%',
      height: tableHeight,
      renderAllRows: false,
      renderAllColumns: false,
      viewportRowRenderingOffset: 20,
      viewportColumnRenderingOffset: 3,
      stretchH: 'none',
      fixedColumnsStart: stickyColumns,
      hiddenColumns:{columns:catalogColumns.map((item,index)=>visibleColumns.has(item.key)?-1:index).filter((index)=>index>=0),indicators:true},
      filters: true,
      dropdownMenu: true,
      multiColumnSorting: true,
      manualColumnMove: true,
      manualColumnResize: true,
      copyPaste: true,
      fillHandle: true,
      contextMenu: false,
      outsideClickDeselects: false,
      beforeBeginEditing: () => {
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (isTouchDevice && !isLongPressEditing) {
          return false;
        }
      },
      cells: (row) => visibleCatalogRows[row]?.access === 'viewer' ? { readOnly: true } : {},
      licenseKey: 'non-commercial-and-evaluation',
      afterChange: (changes, source) => {
        if (!changes?.length || ['loadData', 'rollback'].includes(String(source))) return;
        const touched = new Set<string>();let typeChanged=false;
        for (const [visualRow,property] of changes) {
          const physicalRow = catalogTable?.toPhysicalRow(Number(visualRow)) ?? Number(visualRow);
          const row = catalogTable?.getSourceDataAtRow(physicalRow) as ReferenceRow | undefined;
          if (row?.id) touched.add(row.id);
          if(property==='type')typeChanged=true;
        }
        touched.forEach((id) => { const row = references.get(id); if (row) scheduleSave(row); });
        if(typeChanged&&activeReference)renderProperties(activeReference);
      },
      afterRenderer: (cell,visualRow) => {
        const physical=catalogTable?.toPhysicalRow(visualRow) ?? visualRow; const row=catalogTable?.getSourceDataAtRow(physical) as ReferenceRow | undefined; cell.draggable=Boolean(row);
        cell.classList.remove('duplicate-group-cell','duplicate-group-start');
        if(activeVirtualFolder==='duplicates'&&row){
          const key=duplicateFingerprint(row);const previousPhysical=visualRow>0?(catalogTable?.toPhysicalRow(visualRow-1)??visualRow-1):-1;const previous=previousPhysical>=0?catalogTable?.getSourceDataAtRow(previousPhysical) as ReferenceRow|undefined:undefined;
          cell.classList.add('duplicate-group-cell');cell.classList.toggle('duplicate-group-start',!previous||duplicateFingerprint(previous)!==key);
        }
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
          syncTreeSelection();
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
        const first = [...selectedReferences][0]; if (first) { activeReference = first; renderProperties(first); }
        syncTreeSelection(); setSaveState(`${selectedReferences.size} selected`);
      },
    });
    resizeObserver = new ResizeObserver(([entry]) => {
      const nextHeight = Math.floor(entry.contentRect.height);
      if (!catalogTable || nextHeight < 1 || nextHeight === tableHeight) return;
      tableHeight = nextHeight;
      catalogTable.updateSettings({ height: tableHeight });
    });
    resizeObserver.observe(tableHost);
    if (catalogFilterStatus) catalogFilterStatus.textContent = `${visibleCatalogRows.length} / ${payload.references.length}`;
  };

  const panel = (className: string): HTMLElement => {
    const element = document.createElement('section');
    element.className = `workspace-pod ${className}`;
    return element;
  };

  const podToolbar = (reference: ReferenceRow, element: HTMLElement, panelId?: string): HTMLElement => {
    const toolbar = document.createElement('header');
    toolbar.className = 'pod-toolbar';

    // Maximize button
    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.innerHTML = '⤢';
    maxBtn.title = 'Maximize Panel';
    maxBtn.style.marginRight = '8px';
    maxBtn.style.padding = '0 6px';
    maxBtn.style.fontSize = '17px';
    maxBtn.style.cursor = 'pointer';
    maxBtn.style.border = '0';
    maxBtn.style.background = 'transparent';
    maxBtn.style.color = 'var(--muted)';

    maxBtn.addEventListener('click', () => {
      const isMax = element.classList.toggle('maximized-pod');
      if (!isMax) {
        element.classList.remove('show-maximized-toolbar');
      }
      if (screenfull && screenfull.isEnabled) {
        if (isMax) {
          screenfull.request(element).catch((err) => console.warn('screenfull request failed', err));
        } else if (screenfull.isFullscreen && screenfull.element === element) {
          screenfull.exit();
        }
      }
      if (isMax) {
        maxBtn.innerHTML = '⤣';
        maxBtn.title = 'Restore Panel Size';
        maxBtn.style.color = 'var(--green)';
      } else {
        maxBtn.innerHTML = '⤢';
        maxBtn.title = 'Maximize Panel';
        maxBtn.style.color = 'var(--muted)';
      }
    });

    if (screenfull && screenfull.isEnabled) {
      screenfull.on('change', () => {
        if (!screenfull.isFullscreen && element.classList.contains('maximized-pod')) {
          element.classList.remove('maximized-pod');
          element.classList.remove('show-maximized-toolbar');
          maxBtn.innerHTML = '⤢';
          maxBtn.title = 'Maximize Panel';
          maxBtn.style.color = 'var(--muted)';
        }
      });
    }

    element.addEventListener('click', (e) => {
      if (!element.classList.contains('maximized-pod')) return;
      if ((e.target as HTMLElement).closest('.pod-toolbar')) return;

      const rect = element.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      if (clickY < rect.height * 0.1) {
        e.stopPropagation();
        element.classList.toggle('show-maximized-toolbar');
      }
    });

    toolbar.appendChild(maxBtn);

    const label = document.createElement('span');
    label.textContent = `${reference.fileType} · ${reference.filename}`;
    toolbar.appendChild(label);

    // Document controls (PDF/Text pagination and zoom)
    const docControls = document.createElement('div');
    docControls.className = 'doc-toolbar-controls';
    docControls.style.display = 'flex';
    docControls.style.alignItems = 'center';
    docControls.style.gap = '5px';
    docControls.style.marginRight = '8px';
    docControls.style.marginLeft = 'auto'; // floats in middle between label and actions

    // Invert Colors Button
    const invertBtn = document.createElement('button');
    invertBtn.type = 'button';
    invertBtn.textContent = '◑';
    invertBtn.title = 'Invert Document Colors';
    let isInverted = false;
    invertBtn.addEventListener('click', () => {
      isInverted = !isInverted;
      invertBtn.style.color = isInverted ? 'var(--green)' : '';
      element.dispatchEvent(new CustomEvent('seshat:doc-toggle-invert', { detail: { active: isInverted } }));
    });
    docControls.appendChild(invertBtn);

    // 1:1 Zoom Button
    const zoom11Btn = document.createElement('button');
    zoom11Btn.type = 'button';
    zoom11Btn.textContent = '1:1';
    zoom11Btn.title = 'Fit current page or book spread · 1';
    zoom11Btn.addEventListener('click', () => {
      element.dispatchEvent(new CustomEvent('seshat:pdf-zoom-reset'));
    });
    docControls.appendChild(zoom11Btn);

    if (reference.format === 'pdf') {
      // Pagination Group
      const prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.textContent = '◀';
      prevBtn.title = 'Previous Page';

      const pageIndicator = document.createElement('span');
      pageIndicator.textContent = '1 / —';
      pageIndicator.style.fontSize = '9px';
      pageIndicator.style.fontFamily = 'monospace';
      pageIndicator.style.color = 'var(--muted)';
      pageIndicator.style.padding = '0 4px';

      const nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.textContent = '▶';
      nextBtn.title = 'Next Page';

      let currentPage = 1;
      let totalPages = 1;

      prevBtn.addEventListener('click', () => {
        if (currentPage > 1) {
          element.dispatchEvent(new CustomEvent('seshat:pdf-goto-page', { detail: { page: currentPage - 1 } }));
        }
      });

      nextBtn.addEventListener('click', () => {
        if (currentPage < totalPages) {
          element.dispatchEvent(new CustomEvent('seshat:pdf-goto-page', { detail: { page: currentPage + 1 } }));
        }
      });

      element.addEventListener('seshat:pdf-page-changed', (e: any) => {
        currentPage = e.detail.page;
        totalPages = e.detail.total || totalPages;
        pageIndicator.textContent = `${currentPage} / ${totalPages}`;
      });

      // Double Page layout Toggle Button
      const doubleBtn = document.createElement('button');
      doubleBtn.type = 'button';
      doubleBtn.textContent = 'Book';
      doubleBtn.title = 'Toggle Double Page Facing View';
      let isDouble = false;

      // Mosaic layout Toggle Button
      const mosaicBtn = document.createElement('button');
      mosaicBtn.type = 'button';
      mosaicBtn.textContent = 'Grid';
      mosaicBtn.title = 'Toggle Mosaic Thumbnail Grid';
      let isMosaic = false;

      doubleBtn.addEventListener('click', () => {
        isDouble = !isDouble;
        doubleBtn.textContent = isDouble ? '1-Page' : 'Book';
        doubleBtn.style.color = isDouble ? 'var(--green)' : '';
        element.dispatchEvent(new CustomEvent('seshat:pdf-toggle-double', { detail: { active: isDouble } }));
        if (isDouble && isMosaic) {
          isMosaic = false;
          mosaicBtn.style.color = '';
          element.dispatchEvent(new CustomEvent('seshat:pdf-toggle-mosaic', { detail: { active: false } }));
        }
      });

      mosaicBtn.addEventListener('click', () => {
        isMosaic = !isMosaic;
        mosaicBtn.style.color = isMosaic ? 'var(--green)' : '';
        element.dispatchEvent(new CustomEvent('seshat:pdf-toggle-mosaic', { detail: { active: isMosaic } }));
        if (isMosaic && isDouble) {
          isDouble = false;
          doubleBtn.textContent = 'Book';
          doubleBtn.style.color = '';
          element.dispatchEvent(new CustomEvent('seshat:pdf-toggle-double', { detail: { active: false } }));
        }
      });

      element.addEventListener('seshat:pdf-request-mode',((event:CustomEvent<{mode?:string}>) => {
        if (event.detail?.mode === 'grid') mosaicBtn.click();
        if (event.detail?.mode === 'book') doubleBtn.click();
      }) as EventListener);

      docControls.append(prevBtn, pageIndicator, nextBtn, doubleBtn, mosaicBtn);
    }

    // Style buttons slightly
    docControls.querySelectorAll('button').forEach((btn) => {
      btn.style.height = '20px';
      btn.style.fontSize = '9px';
      btn.style.fontFamily = 'monospace';
      btn.style.border = '1px solid var(--hairline)';
      btn.style.background = 'transparent';
      btn.style.color = 'var(--muted)';
      btn.style.cursor = 'pointer';
      btn.style.padding = '0 6px';
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.addEventListener('mouseenter', () => { btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--ink)'; });
      btn.addEventListener('mouseleave', () => { btn.style.borderColor = 'var(--hairline)'; btn.style.color = 'var(--muted)'; });
    });

    toolbar.appendChild(docControls);

    const readButton=document.createElement('button');readButton.type='button';readButton.className='read-aloud-button';readButton.textContent='Read';const stopReadButton=document.createElement('button');stopReadButton.type='button';stopReadButton.className='read-aloud-stop';stopReadButton.textContent='Stop';stopReadButton.hidden=true;readAloud.attach({referenceId:reference.id,language:reference.language||navigator.language,container:element,button:readButton,stopButton:stopReadButton,report:setSaveState,chirpEnabled:payload.chirpEnabled});toolbar.append(readButton,stopReadButton);
    if(reference.hasKokoroNarration||reference.hasChirpNarration){const provider=reference.hasKokoroNarration?'kokoro':'chirp';const rendered=document.createElement('button');rendered.type='button';rendered.className='rendered-narration-button';rendered.textContent='▶ OGG';rendered.title=`Play rendered ${provider} narration`;rendered.addEventListener('click',()=>element.dispatchEvent(new CustomEvent('seshat:play-rendered',{detail:{provider}})));toolbar.appendChild(rendered);}

    const actions: Array<[string, string]> = [['text','Text'],['graph','Graph'],['structure','Structure'],['analysis','Analysis'],['annotation','Annotate']];
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

    // Phone document close returns to the collection sidebar.
    if (panelId && isPhoneLayout()) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.innerHTML = '✕';
      closeBtn.title = 'Close Panel';
      closeBtn.style.marginLeft = 'auto';
      closeBtn.style.padding = '0 10px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.border = '0';
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = 'var(--muted)';
      closeBtn.style.fontSize = '14px';
      closeBtn.addEventListener('click', () => {
        element.classList.remove('maximized-pod');
        api.getPanel(panelId)?.api.close();
        if(api.hasMaximizedGroup())api.exitMaximizedGroup();root.classList.remove('mobile-focus-mode','properties-open');window.dispatchEvent(new CustomEvent('seshat:set-sidebar',{detail:{collapsed:false}}));
      });
      toolbar.appendChild(closeBtn);
    }

    return toolbar;
  };

  const renderDocument = (element: HTMLElement, referenceId: string, panelId?: string) => {
    documentDisposers.get(element)?.(); documentDisposers.delete(element);
    element.replaceChildren();
    const reference = references.get(referenceId);
    if (!reference) { element.textContent = 'Reference not found.'; return; }
    element.dataset.referenceId = referenceId;
    if (panelId) element.dataset.panelId = panelId; else delete element.dataset.panelId;
    activeReference = referenceId;
    window.dispatchEvent(new CustomEvent('seshat:active-reference-changed', { detail: { referenceId } }));
    element.appendChild(podToolbar(reference, element, panelId));
    const body = document.createElement('div'); body.className = 'pod-document-body'; element.appendChild(body);
    if (reference.format === 'pdf') {
      body.classList.add('pod-pdf-body'); const renderId = crypto.randomUUID(); element.dataset.renderId = renderId;
      void mountPdfViewer(body, reference.id, reference.title, setSaveState).then((dispose) => {
        if (element.dataset.renderId !== renderId || !element.isConnected) dispose(); else documentDisposers.set(element, dispose);
      }).catch((error) => { body.textContent = error instanceof Error ? error.message : 'PDF viewer unavailable'; });
    } else if (reference.format === 'epub') {
      const renderId = crypto.randomUUID(); element.dataset.renderId = renderId;
      void mountEpubReader(body, reference.id, reference.title, setSaveState).then((dispose) => {
        if (element.dataset.renderId !== renderId || !element.isConnected) dispose(); else documentDisposers.set(element, dispose);
      }).catch((error) => { body.textContent = error instanceof Error ? error.message : 'EPUB viewer unavailable'; });
    } else void mountText(body, reference.id, 'markdown');
  };

  const documentRenderer = (referenceId: string, panelId?: string): IContentRenderer => {
    const element = panel('document-pod');
    return { element, init() { renderDocument(element, referenceId, panelId); }, dispose() { element.classList.remove('maximized-pod'); documentDisposers.get(element)?.(); documentDisposers.delete(element); } };
  };

  const previewRenderer = (panelId?: string): IContentRenderer => {
    const element = panel('document-pod');
    return { element, init() { previewRender = (referenceId) => renderDocument(element, referenceId, panelId); if (activeReference) previewRender(activeReference); }, dispose() { previewRender = null; element.classList.remove('maximized-pod'); documentDisposers.get(element)?.(); documentDisposers.delete(element); } };
  };

  const mountText = async (element: HTMLElement, referenceId: string, kind: 'markdown' | 'structure') => {
    element.classList.add('pod-reading-surface');
    const response = await fetch(`/api/library/${referenceId}/artifact/${kind}`);
    if (!response.ok) { element.textContent = kind === 'structure' ? 'Structure is not available yet.' : 'Extracted text is not available yet.'; return; }

    const wrapper = document.createElement('div');
    wrapper.className = 'pod-reading-wrapper';
    element.appendChild(wrapper);

    if (kind === 'structure') {
      type StructureSection = { id: string; level?: number; title?: string; page?: number; kind?: string };
      type StructureBlock = { id: string; kind?: string; label?: string; page?: number; sectionId?: string | null; text?: string };
      const data = await response.json() as { sections?: StructureSection[]; blocks?: StructureBlock[] };
      wrapper.classList.add('structure-outline');
      const icons: Record<string, string> = {
        section: '§', introduction: 'I', references: 'R', appendix: 'A', toc: '≡',
        paragraph: '□', formula: '∑', picture: '▧', table: '▦', list: '⋮', caption: 'C', code: '<>', form: '✓',
      };
      const labels: Record<string, string> = {
        paragraph: 'paragraph', formula: 'formula', picture: 'image', table: 'table', list: 'list', caption: 'caption', code: 'code', form: 'form',
      };
      const naturalStructureText=(value:string)=>{const letters=[...value].filter((character)=>/\p{L}/u.test(character));if(letters.length<2||letters.some((character)=>character!==character.toLocaleUpperCase()))return value;const connectors=new Set(['a','al','and','by','con','de','del','e','el','en','for','in','la','las','los','of','on','o','or','para','por','the','to','u','with','y']);let index=0;return value.toLocaleLowerCase().replace(/\p{L}[\p{L}\p{M}'’]*/gu,(word)=>{const first=index++===0;if(/^(?=[ivxlcdm]+$)m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})$/u.test(word)&&word.length<=8)return word.toLocaleUpperCase();if(!first&&connectors.has(word))return word;return word.replace(/\p{L}/u,(letter)=>letter.toLocaleUpperCase());});};
      const goToPage = (page: unknown) => {
        const target = Number(page); if (!Number.isFinite(target) || target < 1) return;
        const documentElement=[...root.querySelectorAll<HTMLElement>('.document-pod[data-reference-id]')].find((candidate)=>candidate.dataset.referenceId===referenceId);
        const documentPanel=documentElement?.dataset.panelId?api.getPanel(documentElement.dataset.panelId):undefined;
        if(documentPanel){documentPanel.api.setActive();if(isPhoneLayout()){closePhoneAuxiliaryPanels(documentPanel.id);maximizePhonePanel(documentPanel.id);}window.setTimeout(()=>navigatePdfToPage(referenceId,target),0);}
        else{controller.openDocument(referenceId);navigatePdfToPage(referenceId,target);}
      };
      const legend = document.createElement('div'); legend.className = 'structure-legend';
      for (const kind of ['paragraph', 'formula', 'picture', 'table']) {
        const key = document.createElement('span'); key.innerHTML = `<i>${icons[kind]}</i>${labels[kind]}`; legend.appendChild(key);
      }
      wrapper.appendChild(legend);
      const blocksBySection = new Map<string, StructureBlock[]>();
      for (const block of (data.blocks || []).slice(0, 4000)) {
        const key = block.sectionId || '__root__'; const rows = blocksBySection.get(key) || []; rows.push(block); blocksBySection.set(key, rows);
      }
      const list = document.createElement('ol'); list.className = 'pod-outline';
      const renderBlocks = (blocks: StructureBlock[]) => {
        if (!blocks.length) return null;
        const rail = document.createElement('div'); rail.className = 'structure-block-rail';
        for (const block of blocks) {
          const kind = block.kind || 'paragraph'; const marker = document.createElement('button'); marker.type = 'button';
          marker.className = `structure-block structure-block-${kind}`; marker.textContent = icons[kind] || '□';
          marker.title = `${labels[kind] || block.label || kind}${block.page ? ` · p. ${block.page}` : ''}${block.text ? ` · ${naturalStructureText(block.text.slice(0, 120))}` : ''}`;
          marker.setAttribute('aria-label', marker.title); marker.disabled = !block.page; marker.addEventListener('click', (event) => { event.stopPropagation(); goToPage(block.page); }); rail.appendChild(marker);
        }
        return rail;
      };
      const rootBlocks = renderBlocks(blocksBySection.get('__root__') || []);
      if (rootBlocks) { const root = document.createElement('li'); root.className = 'structure-root-blocks'; root.appendChild(rootBlocks); list.appendChild(root); }
      for (const section of (data.sections || []).slice(0, 1000)) {
        const item = document.createElement('li'); item.className = 'structure-section'; item.style.setProperty('--outline-level', String(Math.min(5, Math.max(0, Number(section.level || 1) - 1))));
        const row = document.createElement('button'); row.type = 'button'; row.className = 'structure-section-row'; row.disabled = !section.page; row.dataset.level = String(section.level || 1);
        const semantic = section.kind || 'section'; const glyph = document.createElement('i'); glyph.className = `structure-kind structure-kind-${semantic}`; glyph.textContent = icons[semantic] || '§';
        const copy = document.createElement('span'); copy.className = 'structure-section-copy';
        const heading = document.createElement('span'); heading.className = 'structure-section-title'; heading.textContent = naturalStructureText(section.title || 'Untitled section'); copy.appendChild(heading);
        const rail = renderBlocks(blocksBySection.get(section.id) || []); if (rail) copy.appendChild(rail);
        const page = document.createElement('small'); page.textContent = section.page ? `p. ${section.page}` : `h${section.level || 1}`;
        row.append(glyph, copy, page); row.addEventListener('click', () => goToPage(section.page)); item.appendChild(row); list.appendChild(item);
      }
      wrapper.appendChild(list);
    } else {
      const pre = document.createElement('pre'); pre.textContent = await response.text(); wrapper.appendChild(pre);
    }

    // Local pinch-to-zoom for text view (prevents viewport page zoom) with scroll centering
    let textStartDist = 0;
    let textZoom = 1.0;
    let textZoomStart = 1.0;
    let textTouchCenterX = 0;
    let textTouchCenterY = 0;
    let textContentX = 0;
    let textContentY = 0;

    element.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        textStartDist = Math.sqrt(dx * dx + dy * dy);
        textZoomStart = textZoom;

        const rect = element.getBoundingClientRect();
        textTouchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        textTouchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

        textContentX = (element.scrollLeft + textTouchCenterX) / textZoom;
        textContentY = (element.scrollTop + textTouchCenterY) / textZoom;
      }
    }, { passive: false });

    element.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (textStartDist > 0) {
          const factor = dist / textStartDist;
          textZoom = Math.max(0.5, Math.min(3.0, textZoomStart * factor));
          wrapper.style.zoom = String(textZoom);
          if (!('zoom' in document.documentElement.style)) {
            wrapper.style.transform = `scale(${textZoom})`;
            wrapper.style.transformOrigin = 'top left';
          }
          element.scrollLeft = textContentX * textZoom - textTouchCenterX;
          element.scrollTop = textContentY * textZoom - textTouchCenterY;
        }
      }
    }, { passive: false });

    element.addEventListener('touchend', (e) => {
      if (e.touches.length < 2) {
        textStartDist = 0;
      }
    }, { passive: true });

    element.addEventListener('wheel', (e) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const rect = element.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const px = (element.scrollLeft + mouseX) / textZoom;
        const py = (element.scrollTop + mouseY) / textZoom;

        const delta = -e.deltaY * 0.01;
        textZoom = Math.max(0.5, Math.min(3.0, textZoom + delta));
        wrapper.style.zoom = String(textZoom);
        if (!('zoom' in document.documentElement.style)) {
          wrapper.style.transform = `scale(${textZoom})`;
          wrapper.style.transformOrigin = 'top left';
        }
        element.scrollLeft = px * textZoom - mouseX;
        element.scrollTop = py * textZoom - mouseY;
      }
    }, { passive: false });

    const parent = element.parentElement || element;
    parent.addEventListener('seshat:pdf-zoom-reset', () => {
      textZoom = 1.0;
      wrapper.style.zoom = '1.0';
      wrapper.style.transform = '';
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });

    parent.addEventListener('seshat:doc-toggle-invert', (e: any) => {
      const active = e.detail.active;
      element.classList.toggle('inverted-doc-parent', active);
      wrapper.classList.toggle('inverted-doc', active);
    });

    // Margin invisible page turning areas (25% left/right edges) for text view
    element.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      const rect = element.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = clickX / rect.width;

      if (ratio < 0.25) {
        element.scrollBy({
          top: -element.clientHeight * 0.85,
          behavior: 'smooth'
        });
      } else if (ratio > 0.75) {
        element.scrollBy({
          top: element.clientHeight * 0.85,
          behavior: 'smooth'
        });
      }
    });

    // Double tap/click to zoom reset for text view
    element.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button, a, input, select')) return;
      parent.dispatchEvent(new CustomEvent('seshat:pdf-zoom-reset'));
    });
  };

  const derivativeRenderer = (referenceId: string, kind: 'text' | 'structure', panelId?:string): IContentRenderer => {
    const element = panel(`${kind}-pod`);
    return { element, init() { if(kind==='structure'){const mobileActions=document.createElement('div');mobileActions.className='structure-mobile-actions';addMobileCloseButton(mobileActions,panelId);element.appendChild(mobileActions);}else{const header=document.createElement('header');header.className='pod-heading';header.innerHTML='<div><div class="eyebrow">Document</div><h2>Text</h2></div>';addMobileCloseButton(header,panelId);element.appendChild(header);}void mountText(element, referenceId, kind === 'text' ? 'markdown' : 'structure'); } };
  };

  const maximizePhonePanel=(panelId:string)=>{if(!isPhoneLayout())return;root.classList.remove('properties-open');root.classList.add('mobile-focus-mode');window.setTimeout(()=>{const target=api.getPanel(panelId);if(!target)return;if(api.hasMaximizedGroup())api.exitMaximizedGroup();target.api.setActive();api.maximizeGroup(target);window.dispatchEvent(new Event('resize'));},0);};
  const closePhoneAuxiliaryPanels=(except?:string)=>{if(!isPhoneLayout())return;api.panels.filter((candidate)=>candidate.id!==except&&candidate.id!=='document-preview'&&candidate.id!=='catalog').forEach((candidate)=>candidate.api.close());};
  const restorePhoneDocument=()=>{if(!isPhoneLayout())return;root.classList.remove('properties-open');const documentPanel=api.getPanel('document-preview');if(!documentPanel){root.classList.remove('mobile-focus-mode');window.dispatchEvent(new CustomEvent('seshat:set-sidebar',{detail:{collapsed:false}}));return;}maximizePhonePanel('document-preview');};

  const addMobileCloseButton = (header: HTMLElement, panelId?: string) => {
    if (!panelId) return;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'pod-mobile-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.style.border = '0';
    closeBtn.style.background = 'transparent';
    closeBtn.style.color = 'var(--muted)';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '4px 10px';
    closeBtn.style.fontSize = '14px';
    closeBtn.style.marginLeft = 'auto';
    closeBtn.addEventListener('click', () => {
      api.getPanel(panelId)?.api.close();
      window.setTimeout(restorePhoneDocument,0);
    });
    header.appendChild(closeBtn);
  };

  const toolRenderer = (kind: ToolKind, referenceId?: string, panelId?: string): IContentRenderer => {
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
        const globalGraph = !referenceId;
        element.classList.remove('future-tool-pod'); element.classList.add('graph-tool-pod');
        const body = document.createElement('div'); body.className = 'graph-body';
        const stage = document.createElement('div'); stage.className = 'force-graph-stage';
        const sidebar = document.createElement('aside'); sidebar.className = 'graph-sidebar'; sidebar.setAttribute('aria-label','Graph sidebar');
        const sidebarClose = document.createElement('button'); sidebarClose.type = 'button'; sidebarClose.className = 'graph-sidebar-close'; sidebarClose.title = 'Hide graph sidebar'; sidebarClose.setAttribute('aria-label','Hide graph sidebar'); sidebarClose.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3 10.5 8l-5 5"/></svg>';
        const section=(label:string,open:boolean)=>{const details=document.createElement('details');details.className='graph-sidebar-section';details.open=open;const summary=document.createElement('summary');const text=document.createElement('span');text.textContent=label;const badge=document.createElement('b');summary.append(text,badge);const content=document.createElement('div');content.className='graph-sidebar-content';details.append(summary,content);sidebar.appendChild(details);return{details,summary,content,badge};};
        const infoSection=section('Graph info',true); infoSection.badge.replaceWith(sidebarClose);
        const graphKind=document.createElement('span'); graphKind.className='graph-info-kind'; graphKind.textContent=reference?'Document graph':'Knowledge graph';
        const graphScope=document.createElement('strong'); graphScope.className='graph-info-scope'; graphScope.textContent=reference?.title||'All references';
        const count=document.createElement('span'); count.className='graph-info-count'; count.textContent='Loading…';
        infoSection.content.append(graphKind,graphScope,count);
        const controlsSection=section('Controls',true); controlsSection.badge.remove();
        const controls=document.createElement('div'); controls.className='graph-controls'; controlsSection.content.appendChild(controls);
        const conceptsSection=section('Concepts',true);
        const conceptSidebar=document.createElement('div'); conceptSidebar.className='graph-concepts'; conceptsSection.content.appendChild(conceptSidebar);
        const selectionSection=section('Selection',true); selectionSection.badge.remove();
        const inspector=document.createElement('div'); inspector.className='graph-inspector'; inspector.innerHTML='<p>Select a paper or association to inspect its evidence.</p>'; selectionSection.content.appendChild(inspector);
        const stageActions=document.createElement('div'); stageActions.className='graph-stage-actions';
        const sidebarOpen=document.createElement('button'); sidebarOpen.type='button'; sidebarOpen.className='graph-sidebar-open'; sidebarOpen.title='Show graph sidebar'; sidebarOpen.setAttribute('aria-label','Show graph sidebar'); sidebarOpen.setAttribute('aria-expanded','false'); sidebarOpen.innerHTML='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5"/></svg>';
        stageActions.appendChild(sidebarOpen); addMobileCloseButton(stageActions,panelId);
        body.append(stage,sidebar,stageActions); element.appendChild(body);
        const setSidebarOpen=(open:boolean)=>{body.classList.toggle('graph-sidebar-hidden',!open);sidebarOpen.hidden=open;sidebarOpen.setAttribute('aria-expanded',String(open));sidebar.setAttribute('aria-hidden',String(!open));window.localStorage.setItem(GRAPH_SIDEBAR_KEY,open?'open':'closed');};
        sidebarOpen.addEventListener('click',()=>setSidebarOpen(true)); sidebarClose.addEventListener('click',(event)=>{event.preventDefault();event.stopPropagation();setSidebarOpen(false);});
        setSidebarOpen(window.localStorage.getItem(GRAPH_SIDEBAR_KEY)!=='closed');
        let graph: any = null; let resizeGraph: ResizeObserver | null = null; let graphDocumentChange: EventListener | null = null; let currentGraphReferenceId = referenceId || null; const collapsed = new Set<string>(); let focusId: string | null = null;
        disposeAnnotation = () => { if (graphDocumentChange) window.removeEventListener('seshat:active-reference-changed', graphDocumentChange); resizeGraph?.disconnect(); graph?._destructor?.(); graph = null; };
        const url = referenceId ? `/api/knowledge-graph?paperId=${encodeURIComponent(referenceId)}` : '/api/knowledge-graph?maximumNodes=1000';
        void fetch(url).then((response) => response.json()).then((data) => {
          if (disposed) return;
          const baseNodes = (data.nodes || []).map((node:any) => ({ ...node, classification:node.kind || 'automatic' }));
          const baseLinks = (data.edges || []).map((edge:any,index:number) => ({ ...edge, id:edge.id || `auto-edge:${index}` }));
          const allNodes = [...baseNodes]; const allLinks = [...baseLinks];
          const enabled: Record<string,boolean> = { paper:true,author:true,topic:true,venue:true,institution:true,collection:true };
          const enabledEdges: Record<string,boolean> = { cites:true,'related-to':true,'bibliographic-coupling':true,'co-citation':true,'shared-author':true,'shared-topic':true,'authored-by':true,'has-topic':true,'published-in':true,'affiliated-with':true,'belongs-to-collection':true };
          let neighborDepth = 0; let folding = false; let minimumWeight = 0; let graphQuery = ''; let layoutMode: 'relevance' | 'concepts' = 'relevance';
          const sourceId = (link:any) => String(typeof link.source === 'object' ? link.source.id : link.source); const targetId = (link:any) => String(typeof link.target === 'object' ? link.target.id : link.target);
          const paperKinds=new Set(['paper','work','document','publication','article','ebook']);
          const conceptKinds=new Set(['concept','topic','relatedconcept']);
          const nodeKind=(node:any)=>normalize(node.kind||node.classification).replaceAll('_','-');
          let degreeCache=new Map<string,number>();let repulsion=440;let linkDistance=90;
          const refreshDegrees=()=>{degreeCache=new Map<string,number>();allLinks.forEach((link:any)=>{const source=sourceId(link),target=targetId(link);degreeCache.set(source,(degreeCache.get(source)||0)+1);degreeCache.set(target,(degreeCache.get(target)||0)+1);});};
          const nodeRelevance=(node:any)=>Math.log1p(Number(node.properties?.citedByCount||0))+Math.sqrt(degreeCache.get(String(node.id))||0)+Number(node.properties?.score||0)*2;
          const applyLayout=()=>{if(!graph)return;graph.d3Force('charge')?.strength((node:any)=>-Math.min(1800,repulsion+nodeRelevance(node)*22));graph.d3Force('link')?.distance((link:any)=>Math.max(40,linkDistance-Number(link.weight||0)*12));graph.d3Force('collide',forceCollide((node:any)=>Math.max(13,6+nodeRelevance(node))).strength(.8));if(layoutMode==='concepts'){graph.d3Force('y',forceY((node:any)=>conceptKinds.has(nodeKind(node))?-100:paperKinds.has(nodeKind(node))?90:220).strength((node:any)=>conceptKinds.has(nodeKind(node))?.28:.1));graph.d3Force('radial',forceRadial((node:any)=>conceptKinds.has(nodeKind(node))?Math.max(20,170-nodeRelevance(node)*10):paperKinds.has(nodeKind(node))?250:360,0,0).strength(.09));}else{graph.d3Force('radial',null);graph.d3Force('y',forceY((node:any)=>paperKinds.has(nodeKind(node))?-Math.min(170,nodeRelevance(node)*18):conceptKinds.has(nodeKind(node))?110:210).strength(.08));}graph.d3ReheatSimulation();};
          const visibleData = () => {
            let nodes = allNodes.filter((node:any) => (!(node.kind in enabled) || enabled[node.kind]) && (!graphQuery || normalize(node.label).includes(graphQuery))); const allowed = new Set(nodes.map((node:any) => String(node.id)));
            let links = allLinks.filter((link:any) => (enabledEdges[String(link.relation || link.kind)] ?? true) && Number(link.weight || 0) >= minimumWeight && allowed.has(sourceId(link)) && allowed.has(targetId(link)) && !collapsed.has(sourceId(link)) && !collapsed.has(targetId(link)));
            if (focusId && neighborDepth > 0) { const near = new Set([focusId]); for (let depth=0; depth<neighborDepth; depth += 1) { links.forEach((link:any) => { const source=sourceId(link),target=targetId(link); if (near.has(source)) near.add(target); if (near.has(target)) near.add(source); }); } nodes = nodes.filter((node:any) => near.has(String(node.id))); const ids = new Set(nodes.map((node:any) => String(node.id))); links = links.filter((link:any) => ids.has(sourceId(link)) && ids.has(targetId(link))); }
            return { nodes,links };
          };
          const renderConcepts=()=>{const concepts=allNodes.filter((node:any)=>conceptKinds.has(nodeKind(node))).map((node:any)=>({node,count:degreeCache.get(String(node.id))||0})).sort((left,right)=>right.count-left.count||String(left.node.label).localeCompare(String(right.node.label)));conceptsSection.badge.textContent=String(concepts.length);conceptSidebar.replaceChildren();const list=document.createElement('div');list.className='graph-concept-list';concepts.forEach(({node,count})=>{const control=document.createElement('button');control.type='button';const label=document.createElement('span');label.textContent=String(node.label||'Untitled concept');const total=document.createElement('b');total.textContent=String(count);control.append(label,total);control.onclick=()=>{layoutMode='concepts';layout.value='concepts';focusId=String(node.id);neighborDepth=Math.max(1,neighborDepth);update();renderConceptNode(node);graph.centerAt(Number(node.x)||0,Number(node.y)||0,400);graph.zoom(2.2,400);};list.appendChild(control);});conceptSidebar.appendChild(list);};
          const update = () => { refreshDegrees();const next = visibleData(); count.textContent = `${next.nodes.length} nodes · ${next.links.length} links`; graph.graphData(next); applyLayout(); renderConcepts(); };
          const safe=(value:unknown)=>String(value??'').replace(/[&<>"']/g,(character)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]||character));
          const slider = (label:string,min:number,max:number,value:number,step:number,onInput:(value:number)=>void) => { const wrap=document.createElement('label'); const text=document.createElement('span'); text.textContent=label; const input=document.createElement('input'); input.type='range'; input.min=String(min); input.max=String(max); input.step=String(step); input.value=String(value); const output=document.createElement('output'); output.textContent=String(value); input.addEventListener('input',() => { output.textContent=input.value; onInput(Number(input.value)); }); wrap.append(text,input,output); controls.appendChild(wrap); };
          const toggle = (label:string,checked:boolean,onChange:(checked:boolean)=>void) => { const wrap=document.createElement('label'); wrap.className='graph-switch'; const input=document.createElement('input'); input.type='checkbox'; input.checked=checked; const text=document.createElement('span'); text.textContent=label; input.addEventListener('change',() => onChange(input.checked)); wrap.append(input,text); controls.appendChild(wrap); };
          const button=(label:string,onClick:()=>void)=>{const control=document.createElement('button');control.type='button';control.textContent=label;control.addEventListener('click',onClick);controls.appendChild(control);return control;};
          const searchInput=document.createElement('input'); searchInput.type='search'; searchInput.className='graph-search'; searchInput.placeholder='Find node…'; searchInput.addEventListener('input',()=>{graphQuery=normalize(searchInput.value);update();}); controls.appendChild(searchInput);
          let loadReferenceGraph: (nextReferenceId: string) => Promise<void> = async () => undefined;
          let loadGlobalGraph: (collectionId?: string) => Promise<void> = async () => undefined;
          if(globalGraph){const scopeLabel=document.createElement('label');scopeLabel.className='graph-scope';const scopeText=document.createElement('span');scopeText.textContent='Scope';const scope=document.createElement('select');const all=document.createElement('option');all.value='';all.textContent='All references';scope.appendChild(all);payload.libraries.forEach((library)=>{const option=document.createElement('option');option.value=library.id;option.textContent=library.name;scope.appendChild(option);});scope.addEventListener('change',()=>void loadGlobalGraph(scope.value).catch((error)=>{count.textContent='Graph unavailable';inspector.textContent=error instanceof Error?error.message:'Could not load graph.';}));scopeLabel.append(scopeText,scope);controls.prepend(scopeLabel);}
          const renderPaper=async(node:any)=>{selectionSection.details.open=true;const id=String(node.properties?.referenceId||'');const openAlexId=String(node.properties?.openAlexId||''); inspector.innerHTML=`<div class="eyebrow">${safe(node.kind)}</div><h3>${safe(node.label)}</h3><p>${safe(openAlexId||'Local or bibliography-derived paper')}</p>`; if(!id){if(openAlexId)inspector.insertAdjacentHTML('beforeend',`<p><a href="https://openalex.org/${encodeURIComponent(openAlexId)}" target="_blank" rel="noreferrer">Open in OpenAlex ↗</a></p>`);return;} const response=await fetch(`/api/papers/${encodeURIComponent(id)}`); const data=await response.json(); if(!response.ok){inspector.insertAdjacentHTML('beforeend',`<p class="graph-error">${safe(data.error||'Paper details unavailable.')}</p>`);return;} const paper=data.paper; const work=(paper.openAlexWork||{}) as any; const workTopics=(Array.isArray(work.topics)?work.topics:[]).slice(0,4).map((topic:any)=>String(topic?.name||'')).filter(Boolean); const workType=String(work.type||data.reference?.type||''); const workVenue=String(work.venue?.name||''); const workYear=work.publicationYear?String(work.publicationYear):''; inspector.insertAdjacentHTML('beforeend',`<dl><dt>Status</dt><dd>${safe(paper.resolutionStatus)}</dd><dt>Method</dt><dd>${safe(paper.resolutionMethod||'—')}</dd><dt>Confidence</dt><dd>${Math.round(Number(paper.resolutionConfidence||0)*100)}%</dd>${workType?`<dt>Type</dt><dd>${safe(workType)}</dd>`:''}${workTopics.length?`<dt>Topics</dt><dd>${workTopics.map((topic:string)=>safe(topic)).join(' · ')}</dd>`:''}${workVenue?`<dt>Venue</dt><dd>${safe(workVenue)}</dd>`:''}${workYear?`<dt>Year</dt><dd>${safe(workYear)}</dd>`:''}</dl>`); const actions=document.createElement('div');actions.className='graph-inspector-actions'; const enrich=document.createElement('button');enrich.textContent='Enrich with OpenAlex';enrich.onclick=async()=>{enrich.disabled=true;await fetch(`/api/papers/${encodeURIComponent(id)}/enrich`,{method:'POST'});enrich.textContent='Queued';}; const expand=document.createElement('button');expand.textContent='Refresh references & related papers';expand.onclick=async()=>{expand.disabled=true;expand.textContent='Refreshing…';const result=await fetch('/api/knowledge-graph/expand',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paperId:id})});if(result.ok){await loadReferenceGraph(id);expand.textContent='Refreshed';}else{const error=await result.json().catch(()=>({}));expand.textContent=error.error||'Refresh failed';expand.disabled=false;}}; actions.append(enrich,expand); inspector.appendChild(actions); if(paper.resolutionStatus==='ambiguous'){const candidates=document.createElement('div');candidates.className='graph-candidates';for(const candidate of paper.candidates||[]){const choose=document.createElement('button');const candidateTitle=document.createElement('strong');candidateTitle.textContent=candidate.work?.title||candidate.title||candidate.openAlexId||candidate.id;const candidateScore=document.createElement('small');candidateScore.textContent=`${Math.round(Number(candidate.score||candidate.confidence||0)*100)}% · confirm`;choose.append(candidateTitle,candidateScore);choose.onclick=async()=>{choose.disabled=true;const openAlexId=candidate.work?.id||candidate.openAlexId||candidate.id;const resolved=await fetch(`/api/papers/${encodeURIComponent(id)}/resolve`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({openAlexId})});if(resolved.ok){await loadReferenceGraph(id);choose.textContent='Resolved';}else{const error=await resolved.json().catch(()=>({}));choose.textContent=error.error||'Could not resolve';}};candidates.appendChild(choose);}inspector.appendChild(candidates);}};
          const normalizedNodeKind=nodeKind;
          const renderConceptNode=(node:any)=>{selectionSection.details.open=true;const nodeId=String(node.id);const paperIds=new Set<string>();allLinks.forEach((link:any)=>{if(sourceId(link)===nodeId)paperIds.add(targetId(link));if(targetId(link)===nodeId)paperIds.add(sourceId(link));});const papers=allNodes.filter((candidate:any)=>paperIds.has(String(candidate.id))&&paperKinds.has(nodeKind(candidate))).sort((left:any,right:any)=>nodeRelevance(right)-nodeRelevance(left));inspector.innerHTML=`<div class="eyebrow">Concept</div><h3>${safe(node.label)}</h3><p>${papers.length} connected paper${papers.length===1?'':'s'}</p>`;const list=document.createElement('div');list.className='graph-concept-papers';papers.forEach((paper:any)=>{const control=document.createElement('button');control.type='button';control.textContent=String(paper.label||'Untitled paper');control.title=String(paper.label||'');control.onclick=()=>{focusId=String(paper.id);neighborDepth=Math.max(1,neighborDepth);update();void renderPaper(paper);};list.appendChild(control);});inspector.appendChild(list);};
          const nodeColor=(node:any)=>{const kind=normalizedNodeKind(node);if(['concept','topic','relatedconcept'].includes(kind))return'#b07a3c';if(['person','author','editor','composer','performer'].includes(kind))return'#4f8265';if(['paper','work','document','publication','article','ebook'].includes(kind))return'#657c9f';if(['institution','organization','publisher','venue','journal'].includes(kind))return'#8b628d';if(['place','location','geographicregion'].includes(kind))return'#b35f58';if(['collection'].includes(kind))return'#d1a73b';if(['method','instrument','system'].includes(kind))return'#4d8c93';return'#7f837d';};
          const polygon=(ctx:CanvasRenderingContext2D,x:number,y:number,radius:number,sides:number,rotation=-Math.PI/2)=>{for(let index=0;index<sides;index+=1){const angle=rotation+(index*Math.PI*2)/sides;const px=x+Math.cos(angle)*radius,py=y+Math.sin(angle)*radius;if(index===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);}ctx.closePath();};
          const shortPaperTitle=(value:string)=>{const words=value.trim().split(/\s+/);return words.length>5?`${words.slice(0,5).join(' ')}…`:value;};
          const wrapLabel=(value:string,maximum=30)=>{const lines:string[]=[];for(const word of value.split(/\s+/)){const current=lines.at(-1);if(!current||current.length+word.length+1>maximum)lines.push(word.slice(0,maximum));else lines[lines.length-1]=`${current} ${word}`;}return lines.slice(0,3);};
          const drawNode=(node:any,ctx:CanvasRenderingContext2D,scale:number)=>{const x=Number(node.x)||0,y=Number(node.y)||0,kind=normalizedNodeKind(node),radius=Math.max(4,Math.min(18,Number(node.properties?.radius)||5+nodeRelevance(node)*.45));ctx.save();ctx.beginPath();if(['concept','topic','relatedconcept'].includes(kind))ctx.rect(x-radius,y-radius,radius*2,radius*2);else if(['paper','work','document','publication','article','ebook'].includes(kind))polygon(ctx,x,y,radius*1.25,4,0);else if(['institution','organization','publisher','venue','journal'].includes(kind))polygon(ctx,x,y,radius*1.15,6);else if(['place','location','geographicregion'].includes(kind))polygon(ctx,x,y,radius*1.2,3);else if(['method','instrument','system'].includes(kind))polygon(ctx,x,y,radius*1.15,5);else ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=nodeColor(node);ctx.fill();ctx.lineWidth=Math.max(.7,1/scale);ctx.strokeStyle='rgba(20,30,25,.72)';ctx.stroke();if(kind==='collection'){ctx.beginPath();ctx.arc(x,y,radius*.55,0,Math.PI*2);ctx.stroke();}const full=String(node.label||'');const display=globalGraph&&paperKinds.has(kind)?shortPaperTitle(full):full;const lines=wrapLabel(display,30);ctx.font=`${Math.max(8,11/scale)}px ui-monospace`;ctx.fillStyle=getComputedStyle(document.documentElement).getPropertyValue('--ink').trim()||'#263129';lines.forEach((line,index)=>ctx.fillText(line,x+radius+3,y+3+index*Math.max(10,12/scale)));ctx.restore();};
          graph = new ForceGraph(stage)
            .backgroundColor('rgba(0,0,0,0)')
            .nodeId('id')
            .nodeLabel((node:any)=>String(node.label||''))
            .nodeRelSize(5)
            .linkColor(()=>'rgba(110,120,115,.34)')
            .linkDirectionalArrowLength((link:any)=>String(link.relation||link.kind)==='cites'?3:0)
            .linkDirectionalArrowRelPos(1)
            .nodeCanvasObjectMode(()=>'replace')
            .nodeCanvasObject(drawNode)
            .onNodeClick((node:any)=>{focusId=String(node.id);if(folding){if(collapsed.has(focusId))collapsed.delete(focusId);else collapsed.add(focusId);}if(conceptKinds.has(nodeKind(node)))renderConceptNode(node);else void renderPaper(node);update();})
            .onLinkClick(async(link:any)=>{const edgeId=String(link.id||'');if(!edgeId)return;selectionSection.details.open=true;inspector.innerHTML='<p>Loading evidence…</p>';const response=await fetch(`/api/knowledge-graph/association?edgeId=${encodeURIComponent(edgeId)}`);const data=await response.json();if(!response.ok){inspector.innerHTML=`<p class="graph-error">${safe(data.error||'Evidence unavailable.')}</p>`;return;}const edge=data.association,evidence=edge.properties?.evidence||{},provenance=edge.properties?.provenance||{};inspector.innerHTML=`<div class="eyebrow">Association evidence</div><h3>${safe(edge.sourceLabel)} → ${safe(edge.targetLabel)}</h3><dl><dt>Relation</dt><dd>${safe(edge.kind)}</dd><dt>Weight</dt><dd>${Number(edge.weight).toFixed(3)}</dd><dt>Method</dt><dd>${safe(evidence.method||'—')}</dd><dt>Count</dt><dd>${safe(evidence.count??'—')}</dd><dt>Source</dt><dd>${safe(provenance.source||'—')}</dd><dt>Generated</dt><dd>${safe(provenance.generatedAt||edge.createdAt||'—')}</dd></dl>${evidence.description?`<p>${safe(evidence.description)}</p>`:''}`;});
          graph.graphData({nodes:allNodes,links:allLinks});
          applyLayout();
          slider('Repulsion',30,1800,440,10,(value) => { repulsion=value;applyLayout(); });
          slider('Distance',20,480,90,5,(value) => { linkDistance=value;applyLayout(); });
          slider('Gravity',0,.5,.08,.01,(value) => { graph.d3Force('center')?.strength?.(value); graph.d3ReheatSimulation(); });
          slider('Inertia',.1,.9,.4,.05,(value) => { graph.d3VelocityDecay(value); graph.d3ReheatSimulation(); });
          slider('Neighbors',0,4,0,1,(value) => { neighborDepth=value; update(); });
          slider('Min strength',0,1,0,.05,(value) => { minimumWeight=value; update(); });
          toggle('Fold on click',false,(checked) => { folding=checked; });
          const layoutLabel=document.createElement('label');layoutLabel.className='graph-scope';const layoutText=document.createElement('span');layoutText.textContent='Layout';const layout=document.createElement('select');[['relevance','By relevance'],['concepts','By concepts']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;layout.appendChild(option);});layout.onchange=()=>{layoutMode=layout.value as 'relevance'|'concepts';applyLayout();};layoutLabel.append(layoutText,layout);controls.appendChild(layoutLabel);
          ([['Papers','paper'],['Authors','author'],['Topics','topic'],['Venues','venue'],['Institutions','institution'],['Collections','collection']] as Array<[string,string]>).forEach(([label,key]) => toggle(label,true,(checked) => { enabled[key]=checked; update(); }));
          ([['Citations','cites'],['Related papers','related-to'],['Coupling','bibliographic-coupling'],['Co-citation','co-citation'],['Shared author','shared-author'],['Shared topic','shared-topic']] as Array<[string,string]>).forEach(([label,key]) => toggle(label,true,(checked) => { enabledEdges[key]=checked; update(); }));
          button('Reset',()=>{focusId=null;collapsed.clear();searchInput.value='';graphQuery='';update();graph.zoomToFit(350,40);});
          if(!globalGraph){const refreshSources=button('Refresh sources',()=>{void (async()=>{if(!currentGraphReferenceId)return;refreshSources.disabled=true;refreshSources.textContent='Refreshing…';try{const response=await fetch('/api/knowledge-graph/expand',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paperId:currentGraphReferenceId})});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not refresh graph sources.');await loadReferenceGraph(currentGraphReferenceId);refreshSources.textContent=result.warning==='openalex_not_configured'?'Bibliography refreshed':'Sources refreshed';}catch(error){refreshSources.textContent=error instanceof Error?error.message:'Refresh failed';}finally{refreshSources.disabled=false;}})();});}
          const importInput=document.createElement('input');importInput.type='file';importInput.accept='.pdf,application/pdf';importInput.hidden=true;importInput.onchange=()=>{const file=importInput.files?.[0];if(file)void ingestDocument(file);};controls.appendChild(importInput);button('Import PDF',()=>importInput.click());
          loadReferenceGraph=async(nextReferenceId:string)=>{currentGraphReferenceId=nextReferenceId;const nextReference=references.get(nextReferenceId);count.textContent='Loading…';graphKind.textContent='Document graph';graphScope.textContent=nextReference?.title||'Unknown document';const response=await fetch(`/api/knowledge-graph?paperId=${encodeURIComponent(nextReferenceId)}`,{cache:'no-store'});const next=await response.json();if(!response.ok)throw new Error(next.error||'Could not load graph.');allNodes.splice(0,allNodes.length,...(next.nodes||[]).map((node:any)=>({...node,classification:node.kind||'automatic'})));allLinks.splice(0,allLinks.length,...(next.edges||[]).map((edge:any,index:number)=>({...edge,id:edge.id||`auto-edge:${index}`})));focusId=null;collapsed.clear();inspector.innerHTML=next.focus?.found===false?'<div class="eyebrow">No graph yet</div><p>Resolve or refresh this paper to build connections from its bibliography, citations, and related works.</p>':'<p>Select a paper or association to inspect its evidence.</p>';update();window.requestAnimationFrame(()=>graph.zoomToFit(350,40));};
          loadGlobalGraph=async(collectionId='')=>{count.textContent='Loading…';const collection=payload.libraries.find((library)=>library.id===collectionId);graphKind.textContent='Knowledge graph';graphScope.textContent=collection?.name||'All references';const query=new URLSearchParams({maximumNodes:'1000'});if(collectionId)query.set('collectionId',collectionId);const response=await fetch(`/api/knowledge-graph?${query}`,{cache:'no-store'});const next=await response.json();if(!response.ok)throw new Error(next.error||'Could not load knowledge graph.');allNodes.splice(0,allNodes.length,...(next.nodes||[]).map((node:any)=>({...node,classification:node.kind||'automatic'})));allLinks.splice(0,allLinks.length,...(next.edges||[]).map((edge:any,index:number)=>({...edge,id:edge.id||`auto-edge:${index}`})));focusId=null;collapsed.clear();inspector.innerHTML=next.focus?.requested&&next.focus?.found===false?'<div class="eyebrow">Empty scope</div><p>This collection has no graph connections yet.</p>':'<p>Select a paper or association to inspect its evidence.</p>';update();window.requestAnimationFrame(()=>graph.zoomToFit(350,40));};
          graphDocumentChange=((event:CustomEvent<{referenceId?:string}>)=>{const nextReferenceId=event.detail?.referenceId;if(nextReferenceId)void loadReferenceGraph(nextReferenceId).catch((error)=>{count.textContent='Graph unavailable';inspector.innerHTML=`<p class="graph-error">${safe(error instanceof Error?error.message:'Could not load graph.')}</p>`;});}) as EventListener;
          if(!globalGraph)window.addEventListener('seshat:active-reference-changed',graphDocumentChange);
          resizeGraph = new ResizeObserver(([entry]) => graph.width(entry.contentRect.width).height(entry.contentRect.height)); resizeGraph.observe(stage);if(data.focus?.requested&&data.focus?.found===false)inspector.innerHTML='<div class="eyebrow">No graph yet</div><p>Use Refresh sources to build connections from this paper’s bibliography, citations, and related works.</p>'; update();
        }).catch((error) => { count.textContent='Graph unavailable'; stage.textContent=error instanceof Error ? error.message : 'Could not load graph.'; });
        return;
      }
      if (false && kind === 'graph') {
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
        titleH2.textContent = reference?.title || 'All catalogued knowledge';
        titleDiv.append(titleLabel, titleH2);

        const countSpan = document.createElement('span');
        countSpan.style.fontSize = '11px';
        countSpan.style.color = 'var(--muted)';
        countSpan.textContent = 'Loading graph...';

        header.append(titleDiv, countSpan);
        addMobileCloseButton(header, panelId);
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

          const viewport = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          svg.appendChild(viewport);

          const linkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          viewport.appendChild(linkGroup);
          const nodeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          viewport.appendChild(nodeGroup);

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

          let panX = 0;
          let panY = 0;
          let scale = 1;
          let isPanning = false;
          let startX = 0;
          let startY = 0;

          function updateViewport() {
            viewport.setAttribute('transform', `translate(${panX}, ${panY}) scale(${scale})`);
          }
          updateViewport();

          svg.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            const zoomFactor = 1.1;
            const rectSvg = svg.getBoundingClientRect();
            const mouseX = e.clientX - rectSvg.left;
            const mouseY = e.clientY - rectSvg.top;

            const prevScale = scale;
            if (e.deltaY < 0) {
              scale = Math.min(scale * zoomFactor, 10);
            } else {
              scale = Math.max(scale / zoomFactor, 0.1);
            }
            panX = mouseX - (mouseX - panX) * (scale / prevScale);
            panY = mouseY - (mouseY - panY) * (scale / prevScale);
            updateViewport();
          }, { passive: false });

          svg.addEventListener('mousedown', (e: MouseEvent) => {
            if (e.button !== 0) return;
            isPanning = true;
            startX = e.clientX - panX;
            startY = e.clientY - panY;
            svg.style.cursor = 'move';
          });

          let selectedNode: any = null;
          nodeElements.forEach(({ g, node }: any) => {
            g.addEventListener('mousedown', (e: MouseEvent) => {
              e.stopPropagation();
              selectedNode = node;
              g.style.cursor = 'grabbing';
            });
          });

          svg.addEventListener('mousemove', (e: MouseEvent) => {
            const rectSvg = svg.getBoundingClientRect();
            if (selectedNode) {
              const clientXRel = e.clientX - rectSvg.left;
              const clientYRel = e.clientY - rectSvg.top;
              selectedNode.x = (clientXRel - panX) / scale;
              selectedNode.y = (clientYRel - panY) / scale;
              updatePositions();
            } else if (isPanning) {
              panX = e.clientX - startX;
              panY = e.clientY - startY;
              updateViewport();
            }
          });

          window.addEventListener('mouseup', () => {
            if (selectedNode) {
              nodeElements.forEach(({ g }: any) => { g.style.cursor = 'grab'; });
              selectedNode = null;
            }
            if (isPanning) {
              isPanning = false;
              svg.style.cursor = 'default';
            }
          });
        });
        return;
      }
      if (kind === 'analysis') {
        element.classList.remove('future-tool-pod');
        element.classList.add('analysis-tool-pod');
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
        const eyebrow = document.createElement('div');
        eyebrow.className = 'eyebrow';
        eyebrow.textContent = 'Catalog Intelligence';
        const titleH2 = document.createElement('h2');
        titleH2.style.margin = '4px 0 0';
        titleH2.style.fontSize = '15px';
        titleH2.style.fontFamily = 'Georgia, serif';
        titleH2.textContent = 'Lexical & Structural Analysis';
        titleDiv.append(eyebrow, titleH2);

        const select = document.createElement('select');
        select.style.fontSize = '11px';
        select.style.padding = '4px 8px';
        select.style.border = '1px solid var(--hairline)';
        select.style.background = 'transparent';
        select.style.fontFamily = 'monospace';
        select.style.color = 'var(--ink)';

        const globalOpt = document.createElement('option');
        globalOpt.value = '';
        globalOpt.textContent = 'All Documents (Corpus)';
        select.appendChild(globalOpt);

        references.forEach((ref) => {
          const opt = document.createElement('option');
          opt.value = ref.id;
          opt.textContent = ref.title.slice(0, 50) + (ref.title.length > 50 ? '...' : '');
          if (referenceId === ref.id) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });

        header.append(titleDiv, select);
        addMobileCloseButton(header, panelId);
        element.appendChild(header);

        const contentArea = document.createElement('div');
        contentArea.style.display = 'grid';
        contentArea.style.gridTemplateColumns = '200px 1fr';
        contentArea.style.flex = '1';
        contentArea.style.minHeight = '0';
        element.appendChild(contentArea);

        const sidebar = document.createElement('div');
        sidebar.style.borderRight = '1px solid var(--hairline)';
        sidebar.style.background = 'var(--chrome-deep)';
        sidebar.style.display = 'flex';
        sidebar.style.flexDirection = 'column';
        sidebar.style.padding = '10px 0';
        sidebar.style.overflowY = 'auto';
        contentArea.appendChild(sidebar);

        const details = document.createElement('div');
        details.style.overflowY = 'auto';
        details.style.padding = '20px 24px';
        details.style.background = 'var(--paper)';
        contentArea.appendChild(details);

        const tabs = [
          { id: 'overview', label: 'Overview & Zipf' },
          { id: 'vocabulary', label: 'Vocabulary & N-grams' },
          { id: 'concordance', label: 'KWIC Concordances' },
          { id: 'entities', label: 'Entities & POS' },
          { id: 'topics', label: 'Topic Modeling' },
          { id: 'stylometry', label: 'Stylometry' },
          { id: 'rhetorics', label: 'Rhetorics' },
          { id: 'cartography', label: 'Corpus Map (UMAP)' },
          { id: 'drift', label: 'Thematic Drift' }
        ];

        let activeTab = 'overview';
        let analysisData: any = null;
        const sidebarButtons: HTMLButtonElement[] = [];

        const selectTab = (tabId: string) => {
          activeTab = tabId;
          sidebarButtons.forEach(btn => {
            if (btn.dataset.tabId === tabId) {
              btn.style.background = 'rgba(61,122,88,.1)';
              btn.style.fontWeight = 'bold';
              btn.style.color = 'var(--green)';
            } else {
              btn.style.background = 'transparent';
              btn.style.fontWeight = 'normal';
              btn.style.color = 'var(--ink)';
            }
          });
          renderDetails();
        };

        tabs.forEach(tab => {
          const btn = document.createElement('button');
          btn.dataset.tabId = tab.id;
          btn.textContent = tab.label;
          btn.style.width = '100%';
          btn.style.padding = '8px 16px';
          btn.style.border = '0';
          btn.style.textAlign = 'left';
          btn.style.fontSize = '10px';
          btn.style.textTransform = 'uppercase';
          btn.style.fontFamily = 'monospace';
          btn.style.letterSpacing = '.05em';
          btn.style.cursor = 'pointer';
          btn.addEventListener('click', () => selectTab(tab.id));
          sidebar.appendChild(btn);
          sidebarButtons.push(btn);
        });

        selectTab('overview');

        const loadAnalysis = () => {
          const docId = select.value;
          details.innerHTML = '<div style="font-family:monospace;font-size:12px;color:var(--muted);text-align:center;padding:40px;">Loading analysis metrics...</div>';
          const fetchUrl = docId ? `/api/library/analysis?id=${docId}` : '/api/library/analysis';
          void fetch(fetchUrl)
            .then(r => r.json())
            .then(data => {
              if (disposed) return;
              analysisData = data;
              renderDetails();
            })
            .catch(err => {
              details.innerHTML = `<div style="font-family:monospace;font-size:12px;color:#8b3628;text-align:center;padding:40px;">Error loading metrics: ${err.message}</div>`;
            });
        };

        select.addEventListener('change', loadAnalysis);
        loadAnalysis();

        function renderDetails() {
          if (!analysisData) return;
          details.innerHTML = '';

          if (activeTab === 'overview') {
            const metricsSection = document.createElement('section');
            metricsSection.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Scholarly Vocabulary Metrics</h3>
              <dl class="catalog-facts" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 24px;">
                <div><dt>Total Tokens (Word Count)</dt><dd>${analysisData.summary.totalTokens}</dd></div>
                <div><dt>Unique Words (Lexicon Size)</dt><dd>${analysisData.summary.totalTypes}</dd></div>
                <div><dt>Type-Token Ratio (TTR)</dt><dd>${analysisData.summary.ttr} <span style="font-size:9px;color:var(--muted);">(richness)</span></dd></div>
                <div><dt>Hapax Legomena</dt><dd>${analysisData.summary.hapaxCount} <span style="font-size:9px;color:var(--muted);">(singles)</span></dd></div>
              </dl>
            `;
            details.appendChild(metricsSection);

            const zipfSection = document.createElement('section');
            zipfSection.style.marginTop = '28px';
            zipfSection.innerHTML = `<h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 12px;">Zipf Lexical Distribution</h3>
              <p style="font-size:11px;color:var(--muted);margin:0 0 20px;line-height:1.4;">Zipf's Law models rank-frequency: <code>f(r) ∝ C / r<sup>α</sup></code>. Displays actual frequencies (green) against theoretical projection (dashed black) on a log-log scale.</p>`;

            const zipfContainer = document.createElement('div');
            zipfContainer.style.height = '240px';
            zipfContainer.style.border = '1px solid var(--hairline)';
            zipfContainer.style.background = 'var(--chrome-deep)';
            zipfContainer.style.position = 'relative';

            const svgWidth = 600;
            const svgHeight = 220;
            const svgZ = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgZ.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
            svgZ.style.width = '100%';
            svgZ.style.height = '100%';

            const points = analysisData.zipf;
            if (points.length > 0) {
              const maxFreq = points[0].freq;
              const padding = 35;
              const graphW = svgWidth - padding * 2;
              const graphH = svgHeight - padding * 2;

              const logScaleX = (rank: number) => {
                const val = Math.log(rank) / Math.log(100);
                return padding + val * graphW;
              };
              const logScaleY = (freq: number) => {
                const val = Math.log(freq || 1) / Math.log(maxFreq || 1);
                return padding + graphH - (val * graphH);
              };

              for (let scaleVal = 1; scaleVal <= 100; scaleVal *= 10) {
                const lx = logScaleX(scaleVal);
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', String(lx));
                line.setAttribute('y1', String(padding));
                line.setAttribute('x2', String(lx));
                line.setAttribute('y2', String(padding + graphH));
                line.setAttribute('stroke', 'rgba(23,35,29,.12)');
                line.setAttribute('stroke-dasharray', '2 2');
                svgZ.appendChild(line);

                const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                labelText.setAttribute('x', String(lx));
                labelText.setAttribute('y', String(padding + graphH + 12));
                labelText.setAttribute('font-size', '8px');
                labelText.setAttribute('font-family', 'monospace');
                labelText.setAttribute('fill', 'var(--muted)');
                labelText.setAttribute('text-anchor', 'middle');
                labelText.textContent = `Rank ${scaleVal}`;
                svgZ.appendChild(labelText);
              }

              let pathD = '';
              let alphaD = '';
              points.forEach((pt: any, i: number) => {
                const px = logScaleX(pt.rank);
                const py = logScaleY(pt.freq);
                const apy = logScaleY(pt.alphaFreq);

                if (i === 0) {
                  pathD = `M ${px} ${py}`;
                  alphaD = `M ${px} ${apy}`;
                } else {
                  pathD += ` L ${px} ${py}`;
                  alphaD += ` L ${px} ${apy}`;
                }
              });

              const zipfLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              zipfLine.setAttribute('d', pathD);
              zipfLine.setAttribute('fill', 'none');
              zipfLine.setAttribute('stroke', 'var(--green)');
              zipfLine.setAttribute('stroke-width', '2.5');
              svgZ.appendChild(zipfLine);

              const projectionLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
              projectionLine.setAttribute('d', alphaD);
              projectionLine.setAttribute('fill', 'none');
              projectionLine.setAttribute('stroke', '#888888');
              projectionLine.setAttribute('stroke-dasharray', '4 4');
              projectionLine.setAttribute('stroke-width', '1.5');
              svgZ.appendChild(projectionLine);
            }

            zipfContainer.appendChild(svgZ);
            zipfSection.appendChild(zipfContainer);
            details.appendChild(zipfSection);
          }

          else if (activeTab === 'vocabulary') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Vocabulary Distribution (N-grams)</h3>
              <div class="ngrams-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
                <div>
                  <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">Top Unigrams</h4>
                  <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                    <tbody>
                      ${analysisData.vocabulary.slice(0, 15).map((w: any) => `
                        <tr>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);">${w.word}</td>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${w.count}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">Top Bigrams</h4>
                  <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                    <tbody>
                      ${analysisData.bigrams.slice(0, 15).map((bg: any) => `
                        <tr>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line); font-style:italic;">"${bg.ngram}"</td>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${bg.count}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style="margin-top:24px;">
                <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">Top Trigrams</h4>
                <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                  <tbody>
                    ${analysisData.trigrams.slice(0, 12).map((tg: any) => `
                      <tr>
                        <td style="padding:6px 12px;border-bottom:1px solid var(--line);font-style:italic;font-size:12px;">"${tg.ngram}"</td>
                        <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${tg.count}</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            `;
          }

          else if (activeTab === 'concordance') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 8px;">Concordances KWIC</h3>
              <p style="font-size:11px;color:var(--muted);margin:0 0 18px;">Search for a term to locate keyword-in-context (KWIC) matches across the selected document text.</p>
              <div style="display:flex;gap:8px;margin-bottom:20px;">
                <input id="kwic-query" type="text" placeholder="e.g. objects, milieu, organology..." style="flex:1;height:32px;padding:0 12px;border:1px solid var(--hairline);font-family:monospace;font-size:12px;color:var(--ink);background:transparent;" />
                <button id="kwic-btn" class="button primary" style="min-height:32px;font-size:11px;">Search KWIC</button>
              </div>
              <div id="kwic-results" style="border:1px solid var(--hairline);min-height:100px;background:var(--chrome-deep);overflow-x:auto;">
                <div style="font-family:monospace;font-size:11px;color:var(--muted);text-align:center;padding:30px;">Enter a query above to view concordances.</div>
              </div>
            `;

            const queryInput = details.querySelector('#kwic-query') as HTMLInputElement;
            const searchBtn = details.querySelector('#kwic-btn') as HTMLButtonElement;
            const resultsDiv = details.querySelector('#kwic-results') as HTMLDivElement;

            const runKwic = () => {
              const query = queryInput.value.trim().toLowerCase();
              if (!query) return;
              resultsDiv.innerHTML = '<div style="font-family:monospace;font-size:11px;color:var(--muted);text-align:center;padding:30px;">Searching context...</div>';

              const docId = select.value;
              const fetchUrl = docId ? `/api/library/analysis?id=${docId}&q=${query}` : `/api/library/analysis?q=${query}`;

              void fetch(fetchUrl)
                .then(r => r.json())
                .then((kwicData: any) => {
                  if (disposed) return;
                  if (!kwicData.matches || kwicData.matches.length === 0) {
                    resultsDiv.innerHTML = '<div style="font-family:monospace;font-size:11px;color:var(--muted);text-align:center;padding:30px;">No concordances found for query.</div>';
                    return;
                  }

                  const table = document.createElement('table');
                  table.style.width = '100%';
                  table.style.fontSize = '11px';
                  table.style.fontFamily = 'monospace';
                  table.style.borderCollapse = 'collapse';

                  kwicData.matches.forEach((m: any) => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid var(--line)';

                    const leftTd = document.createElement('td');
                    leftTd.style.width = '45%';
                    leftTd.style.padding = '8px';
                    leftTd.style.textAlign = 'right';
                    leftTd.style.color = 'var(--muted)';
                    leftTd.textContent = m.left;

                    const keyTd = document.createElement('td');
                    keyTd.style.width = '10%';
                    keyTd.style.padding = '8px';
                    keyTd.style.textAlign = 'center';
                    keyTd.style.fontWeight = 'bold';
                    keyTd.style.color = 'var(--green)';
                    keyTd.textContent = m.key;

                    const rightTd = document.createElement('td');
                    rightTd.style.width = '45%';
                    rightTd.style.padding = '8px';
                    rightTd.style.textAlign = 'left';
                    rightTd.textContent = m.right;

                    tr.append(leftTd, keyTd, rightTd);
                    table.appendChild(tr);
                  });

                  resultsDiv.innerHTML = '';
                  resultsDiv.appendChild(table);
                })
                .catch(err => {
                  resultsDiv.innerHTML = `<div style="font-family:monospace;font-size:11px;color:#8b3628;text-align:center;padding:30px;">Error matching context: ${err.message}</div>`;
                });
            };

            searchBtn.addEventListener('click', runKwic);
            queryInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') runKwic();
            });
          }

          else if (activeTab === 'entities') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Entities & POS tagging</h3>
              <div style="display:grid;grid-template-columns:1.5fr 1fr;gap:24px;margin-bottom:24px;">
                <div>
                  <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">Graph NER Entities</h4>
                  <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                    <thead>
                      <tr style="background:var(--chrome-deep);text-transform:uppercase;font-size:9px;color:var(--muted);">
                        <th style="padding:6px 12px;text-align:left;">Label</th>
                        <th style="padding:6px 12px;text-align:left;">Kind</th>
                        <th style="padding:6px 12px;text-align:right;">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${analysisData.entities.length > 0 ? analysisData.entities.slice(0, 10).map((e: any) => `
                        <tr>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);font-weight:bold;">${e.label}</td>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);color:var(--green);">${e.kind}</td>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${e.count}</td>
                        </tr>
                      `).join('') : '<tr><td colspan="3" style="padding:20px;text-align:center;color:var(--muted);">No graph entities extracted yet. Run the relate stage.</td></tr>'}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">POS Distribution</h4>
                  <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                    <tbody>
                      <tr><td style="padding:6px 12px;border-bottom:1px solid var(--line);">Nouns</td><td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${analysisData.pos.nouns} matches</td></tr>
                      <tr><td style="padding:6px 12px;border-bottom:1px solid var(--line);">Verbs</td><td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${analysisData.pos.verbs} matches</td></tr>
                      <tr><td style="padding:6px 12px;border-bottom:1px solid var(--line);">Adjectives</td><td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${analysisData.pos.adjectives} matches</td></tr>
                      <tr><td style="padding:6px 12px;border-bottom:1px solid var(--line);">Adverbs</td><td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${analysisData.pos.adverbs} matches</td></tr>
                      <tr><td style="padding:6px 12px;border-bottom:1px solid var(--line);">Prepositions</td><td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${analysisData.pos.prepositions} matches</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }

          else if (activeTab === 'topics') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Thematic Topic Modeling (LDA)</h3>
              <p style="font-size:11px;color:var(--muted);margin:0 0 20px;">Probabilistic clustering of terms based on Dirichlet Allocation representing key conceptual dimensions.</p>
              <div style="display:flex;flex-direction:column;gap:16px;">
                ${analysisData.topics.map((t: any) => `
                  <div>
                    <div style="display:flex;justify-content:space-between;font-family:monospace;font-size:11px;margin-bottom:6px;">
                      <span style="font-weight:bold;">${t.name}</span>
                      <span style="color:var(--green);">${t.weight}% weight</span>
                    </div>
                    <div style="height:6px;background:var(--chrome-deep);border:1px solid var(--hairline);position:relative;border-radius:3px;overflow:hidden;">
                      <div style="width:${t.weight}%;height:100%;background:var(--green);transition:width 0.4s ease;"></div>
                    </div>
                  </div>
                `).join('')}
              </div>
            `;
          }

          else if (activeTab === 'stylometry') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Stylometric Profile</h3>
              <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:20px;">
                <div style="border:1px solid var(--hairline);padding:16px;background:var(--chrome-deep);">
                  <div style="font-family:monospace;font-size:10px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Vocabulary Richness Density</div>
                  <div style="font-family:Georgia,serif;font-size:24px;">${analysisData.stylometry.vocabularyDensity}%</div>
                  <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:6px;">(Unique Types / Total Tokens)</div>
                </div>
                <div style="border:1px solid var(--hairline);padding:16px;background:var(--chrome-deep);">
                  <div style="font-family:monospace;font-size:10px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Average Sentence Length</div>
                  <div style="font-family:Georgia,serif;font-size:24px;">${analysisData.stylometry.avgSentenceLength} words</div>
                  <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:6px;">(Total Tokens / Sentence count)</div>
                </div>
                <div style="border:1px solid var(--hairline);padding:16px;background:var(--chrome-deep);">
                  <div style="font-family:monospace;font-size:10px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Sentence Count</div>
                  <div style="font-family:Georgia,serif;font-size:24px;">${analysisData.stylometry.sentenceCount}</div>
                  <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:6px;">(Total punctuation-terminated segments)</div>
                </div>
                <div style="border:1px solid var(--hairline);padding:16px;background:var(--chrome-deep);">
                  <div style="font-family:monospace;font-size:10px;text-transform:uppercase;color:var(--muted);margin-bottom:4px;">Flesch Reading Ease</div>
                  <div style="font-family:Georgia,serif;font-size:24px;">${analysisData.stylometry.readability} / 100</div>
                  <div style="font-family:monospace;font-size:9px;color:var(--muted);margin-top:6px;">(Standard syntactic readability rating)</div>
                </div>
              </div>
            `;
          }

          else if (activeTab === 'rhetorics') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Rhetorics & Narratology</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
                <div>
                  <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">Rhetorical Markers</h4>
                  <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                    <tbody>
                      ${analysisData.rhetorics.map((r: any) => `
                        <tr>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-transform:capitalize;">${r.name}</td>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${r.count}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
                <div>
                  <h4 style="font-family:monospace;font-size:11px;text-transform:uppercase;color:var(--green);border-bottom:1px solid var(--hairline);padding-bottom:6px;margin:0 0 10px;">Narrative Voices & Modality</h4>
                  <table class="structure-list" style="width:100%;font-size:11px;font-family:monospace;border:1px solid var(--hairline);">
                    <tbody>
                      ${analysisData.narratives.map((n: any) => `
                        <tr>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-transform:capitalize;">${n.name}</td>
                          <td style="padding:6px 12px;border-bottom:1px solid var(--line);text-align:right;color:var(--muted);">${n.count}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            `;
          }

          else if (activeTab === 'cartography') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 12px;">Corpus Cartography (2D UMAP Map)</h3>
              <p style="font-size:11px;color:var(--muted);margin:0 0 16px;line-height:1.4;">2D projection of references based on semantic embedding similarity. Click on a point to open that document directly.</p>
              <div id="umap-container" style="border:1px solid var(--hairline);background:var(--chrome-deep);height:320px;position:relative;"></div>
            `;

            const umapContainer = details.querySelector('#umap-container') as HTMLDivElement;
            const svgWidth = 600;
            const svgHeight = 300;
            const svgU = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgU.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
            svgU.style.width = '100%';
            svgU.style.height = '100%';

            analysisData.cartography.forEach((pt: any) => {
              const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
              circle.setAttribute('cx', String(pt.x));
              circle.setAttribute('cy', String(pt.y));
              circle.setAttribute('r', '6');
              circle.setAttribute('fill', pt.cluster === 1 ? 'var(--green)' : pt.cluster === 2 ? '#3b7a80' : '#8b3628');
              circle.setAttribute('style', 'cursor:pointer; transition: r 0.2s;');

              const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'title');
              titleText.textContent = `[${pt.citeKey}] ${pt.title}`;
              circle.appendChild(titleText);

              circle.addEventListener('mouseover', () => {
                circle.setAttribute('r', '10');
              });
              circle.addEventListener('mouseout', () => {
                circle.setAttribute('r', '6');
              });
              circle.addEventListener('click', () => {
                controller.openDocument(pt.id);
              });

              svgU.appendChild(circle);

              if (Math.random() > 0.6) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', String(pt.x + 8));
                text.setAttribute('y', String(pt.y + 4));
                text.setAttribute('font-family', 'monospace');
                text.setAttribute('font-size', '8px');
                text.setAttribute('fill', 'var(--muted)');
                text.textContent = pt.citeKey || '';
                svgU.appendChild(text);
              }
            });

            umapContainer.appendChild(svgU);
          }

          else if (activeTab === 'drift') {
            details.innerHTML = `
              <h3 style="font-family:Georgia,serif;font-weight:normal;margin:0 0 16px;">Thematic Cartography</h3>
              <p style="font-size:11px;color:var(--muted);margin:0 0 20px;line-height:1.4;">Diachronic Semantic Drift: shows semantic adjustments across periods (concept timeline).</p>
              <div style="border:1px solid var(--hairline);padding:24px;background:var(--chrome-deep);font-family:monospace;font-size:11px;line-height:1.6;">
                <div style="font-weight:bold;color:var(--green);margin-bottom:10px;">[Concept Timeline Projection]</div>
                <div style="display:grid;grid-template-columns:80px 1fr;gap:12px;margin-bottom:8px;">
                  <span style="color:var(--muted);">1950-1960s</span>
                  <span>Emergence of "sound objects" and "concrete music" (Schaeffer, Moles).</span>
                </div>
                <div style="display:grid;grid-template-columns:80px 1fr;gap:12px;margin-bottom:8px;">
                  <span style="color:var(--muted);">1970-1980s</span>
                  <span>Shift toward "instrumental synthesis" and "spectral acoustics" (Grisey, Murail).</span>
                </div>
                <div style="display:grid;grid-template-columns:80px 1fr;gap:12px;margin-bottom:8px;">
                  <span style="color:var(--muted);">1990-2000s</span>
                  <span>"Post-medium condition", media-oriented instruments (Ciciliani).</span>
                </div>
                <div style="display:grid;grid-template-columns:80px 1fr;gap:12px;">
                  <span style="color:var(--muted);">2010s-Present</span>
                  <span>"Organology of dreams", "digital neg-entropocene" (Stiegler, Malevich).</span>
                </div>
              </div>
            `;
          }
        }
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
        addMobileCloseButton(header, panelId);

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
      element.classList.remove('future-tool-pod');
      element.classList.add('future-tool-pod-active');
      element.style.display = 'flex';
      element.style.flexDirection = 'column';
      element.style.height = '100%';
      element.style.background = 'var(--paper)';

      const header = document.createElement('header');
      header.className = 'pod-heading';
      header.style.padding = '12px 16px';
      header.style.borderBottom = '1px solid var(--line)';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';

      const titleH2 = document.createElement('h2');
      titleH2.style.margin = '0';
      titleH2.style.fontSize = '15px';
      titleH2.style.fontFamily = 'Georgia, serif';
      titleH2.textContent = kind === 'agent' ? 'Agent Workspace' : 'Annotation Workspace';
      header.appendChild(titleH2);
      addMobileCloseButton(header, panelId);
      element.appendChild(header);

      const content = document.createElement('div');
      content.style.flex = '1';
      content.style.padding = '24px';
      content.style.display = 'flex';
      content.style.flexDirection = 'column';
      content.style.alignItems = 'center';
      content.style.justifyContent = 'center';
      content.style.textAlign = 'center';

      const glyph = kind === 'annotation' ? '✎' : '✣';
      const headingGlyph = document.createElement('div'); headingGlyph.className = 'future-tool-glyph'; headingGlyph.textContent = glyph; content.appendChild(headingGlyph);
      const copy = document.createElement('p'); copy.textContent = reference
        ? `Context attached to “${reference.title}”. This pod slot is ready for its own lifecycle and persistence.`
        : 'Open a document first to attach evidence and provenance to this pod.'; content.appendChild(copy);
      element.appendChild(content);
    }, dispose() { disposed = true; disposeAnnotation(); } };
  };

  const bibliographyRenderer = (batchId: string, panelId?: string): IContentRenderer => {
    const element = panel('bibliography-pod');
    return { element, init() {
      const data = JSON.parse(window.sessionStorage.getItem(`seshat.bibliography.${batchId}`) || '{"entries":[],"errors":[]}');
      const header = document.createElement('header'); header.className = 'bibliography-pod-head';
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      const title = document.createElement('h2'); title.textContent = `${data.entries.length} parsed references`;
      const health = document.createElement('span'); health.textContent = data.errors.length ? `${data.errors.length} issues` : 'syntax healthy';
      header.append(title, health);
      addMobileCloseButton(header, panelId);
      element.appendChild(header);
      const controls = document.createElement('div'); controls.className = 'bibliography-import-controls';
      const name = document.createElement('input'); name.type = 'text'; name.placeholder = 'New library name';
      name.value = (bibliographyFiles.get(batchId)?.[0]?.name || 'Bibliography').replace(/\.bib$/i, '');
      name.title = 'Fallback folder for records without a compatible file path';
      const analysisToggle = document.createElement('label'); analysisToggle.className = 'bibliography-analysis-toggle';
      const analysisCheckbox = document.createElement('input'); analysisCheckbox.type = 'checkbox'; analysisCheckbox.checked = true;
      const analysisCopy = document.createElement('span');
      const analysisTitle = document.createElement('strong'); analysisTitle.textContent = 'Analyze linked files automatically';
      const analysisHelp = document.createElement('small'); analysisHelp.textContent = 'Turn off for large imports; analyze selected items later from the catalog menu.';
      analysisCopy.append(analysisTitle, analysisHelp); analysisToggle.append(analysisCheckbox, analysisCopy);
      const importButton = document.createElement('button'); importButton.type = 'button'; importButton.textContent = 'Create tree and import';
      importButton.disabled = Number(data.storage?.unavailable || 0) > 0;
      importButton.addEventListener('click', async () => {
        const files = bibliographyFiles.get(batchId) || [];
        if (!files.length) { setSaveState('Bibliography files are no longer available; drop them again.', 'error'); return; }
        importButton.disabled = true; importButton.textContent = 'Importing…';
        setSaveState('creating tree & linking files…', 'saving');
        const form = new FormData(); files.forEach((file) => form.append('files', file, file.name));
        form.set('libraryName', name.value || 'BibTeX import');
        form.set('analyzeAutomatically', analysisCheckbox.checked ? 'true' : 'false');
        try {
          const response = await fetch('/api/bibliography/import', { method: 'POST', body: form });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.error || 'Bibliography import failed.');
          (result.libraries || []).forEach((library: LibraryNode) => {
            const current = payload.libraries.find((item) => item.id === library.id);
            if (current) Object.assign(current, library); else payload.libraries.push(library);
          });
          (result.references || []).forEach((reference: any) => upsertRow(rowFromCatalogReference(reference)));
          bibliographyFiles.delete(batchId);
          health.textContent = `${result.imported} imported · ${result.linked || 0} Wasabi files linked · ${result.missing?.length || 0} missing · ${result.analyzeAutomatically ? 'analysis queued' : 'analysis deferred'}`;
          importButton.textContent = 'Imported'; setSaveState('bibliography imported'); renderTree(search.value);
        } catch (error) {
          importButton.disabled = false; importButton.textContent = 'Import references';
          setSaveState(error instanceof Error ? error.message : 'Bibliography import failed', 'error');
        }
      });
      const storage = document.createElement('span'); storage.className = 'bibliography-storage-health';
      storage.textContent = `${data.storage?.linked || 0} linked · ${data.storage?.missing || 0} missing · ${data.storage?.withoutAttachment || 0} without file`;
      if (data.storage?.unavailable) storage.textContent += ' · Wasabi unavailable';
      controls.append(name, importButton, storage, analysisToggle); element.appendChild(controls);
      const preview = document.createElement('div'); preview.className = 'bibliography-tree-preview';
      const treeRoot: any = { children: new Map<string, any>(), files: [] };
      for (const entry of data.entries) {
        if (!entry.attachment) continue;
        let cursor = treeRoot;
        for (const segment of entry.attachment.directories || []) {
          if (!cursor.children.has(segment)) cursor.children.set(segment, { children: new Map<string, any>(), files: [] });
          cursor = cursor.children.get(segment);
        }
        cursor.files.push({ name: entry.attachment.filename, status: entry.attachment.status });
      }
      const appendTree = (node: any, container: HTMLElement) => {
        for (const [folderName, child] of [...node.children.entries()].sort(([left]: any, [right]: any) => left.localeCompare(right))) {
          const branch = document.createElement('details'); branch.open = true;
          const label = document.createElement('summary'); label.textContent = `${folderName}/`; branch.appendChild(label);
          const nested = document.createElement('div'); nested.className = 'bibliography-tree-children'; appendTree(child, nested); branch.appendChild(nested); container.appendChild(branch);
        }
        for (const file of node.files) {
          const row = document.createElement('div'); row.className = 'bibliography-tree-file';
          const label = document.createElement('span'); label.textContent = file.name;
          const status = document.createElement('small'); status.textContent = file.status; status.dataset.status = file.status;
          row.append(label, status); container.appendChild(row);
        }
      };
      appendTree(treeRoot, preview);
      if (!preview.childElementCount) preview.textContent = 'No attachment paths found; references will use the fallback folder.';
      element.appendChild(preview);
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
    scrollbars: 'native',
    singleTabMode: 'default',
    createComponent: (options) => {
      const name = options.name;
      if (name === 'catalog') {
        const element = panel('catalog-pod');
        return { element, init() { window.requestAnimationFrame(() => mountCatalog(element)); }, dispose() {
          cleanupCatalogThemeListener?.();
          catalogTable?.destroy();
          catalogTable = null;
        } };
      }
      if (name === 'document-preview') return previewRenderer(options.id);
      if (name.startsWith('document:')) return documentRenderer(name.slice('document:'.length), options.id);
      if (name.startsWith('text:')) return derivativeRenderer(name.slice('text:'.length), 'text',options.id);
      if (name.startsWith('structure:')) return derivativeRenderer(name.slice('structure:'.length), 'structure',options.id);
      if (name.startsWith('tool:')) {
        const [, kind, referenceId] = name.split(':');
        return toolRenderer(kind as ToolKind, referenceId || undefined, options.id);
      }
      if (name.startsWith('bibliography:')) return bibliographyRenderer(name.slice('bibliography:'.length), options.id);
      return toolRenderer('analysis', undefined, options.id);
    },
  });
  const openDragIds = (event:DragEvent):string[] => { try { const value=JSON.parse(event.dataTransfer?.getData('application/x-seshat-open-references') || '[]'); return Array.isArray(value) ? value.filter((id) => typeof id === 'string' && references.has(id)) : []; } catch { return []; } };
  api.onUnhandledDragOverEvent((event) => { if (event.nativeEvent.dataTransfer?.types.includes('application/x-seshat-open-references')) event.accept(); });
  api.onDidDrop((event) => {
    const ids=openDragIds(event.nativeEvent); if (!ids.length) return; event.nativeEvent.preventDefault();
    const direction=({top:'above',bottom:'below',left:'left',right:'right',center:'within'} as const)[event.position]; let referencePanel=event.panel || event.group?.activePanel || api.activePanel;
    ids.forEach((id,index) => { const reference=references.get(id); if (!reference) return; const panel=api.addPanel({ id:`document-drop-${id}-${Date.now()}-${index}`,component:`document:${id}`,title:reference.title,position:referencePanel ? {referencePanel,direction:index === 0 ? direction : 'within'} : undefined }); referencePanel=panel; });
    activeReference=ids[0]; renderProperties(activeReference); setSaveState(`${ids.length} item${ids.length === 1 ? '' : 's'} opened in pods`);
  });

  const addPanel = (id: string, component: string, title: string, direction: 'right' | 'below' | 'within' = 'right') => {
    const existing = api.getPanel(id);
    if (existing) { existing.api.setActive(); return existing; }
    const referencePanel = api.activePanel || api.panels[api.panels.length - 1];
    return api.addPanel({ id, component, title, position: referencePanel ? { referencePanel, direction } : undefined });
  };

  function renderProperties(referenceId: string | null) {
    if (!propertiesContent) return;
    const row = referenceId ? references.get(referenceId) : undefined; propertiesContent.replaceChildren();
    if (!row) { const empty = document.createElement('p'); empty.className = 'property-empty'; empty.textContent = 'Select an item to inspect its full record.'; propertiesContent.appendChild(empty); return; }
    const form = document.createElement('form'); form.className = 'property-form';
    const field = (labelText: string, key: keyof Pick<ReferenceRow,'title'|'citeKey'|'year'|'language'|'publisher'|'publisherPlace'|'url'|'abstract'|'isbn'>) => {
      const label = document.createElement('label'); label.className = 'property-field'; const caption = document.createElement('span'); caption.textContent = labelText;
      const input = key==='abstract'?document.createElement('textarea'):document.createElement('input'); input.value = String(row[key] || ''); input.disabled = row.access === 'viewer';
      if(key==='year'){input.inputMode='text';input.placeholder='e.g. 2024 or -350';input.title='Negative years represent BCE; year 0 is not used.';}
      input.addEventListener('change',() => { (row as any)[key] = key === 'year' ? (parsePublicationYear(input.value) ?? input.value) : input.value; refreshTable(); renderTree(search?.value || ''); scheduleSave(row); });
      label.append(caption,input);
      if (input instanceof HTMLInputElement && ['publisher','publisherPlace','language'].includes(key)) {
        const suggestionKey = key === 'publisherPlace' ? 'place' : key;
        attachMetadataSuggestions(input,label,() => valueSuggestions(suggestionKey),(value) => { input.value = value; input.dispatchEvent(new Event('change',{ bubbles:true })); });
      }
      form.appendChild(label);
    };
    const biblatexField=(definition:(typeof BIBLATEX_FIELD_OPTIONS)[number])=>{const coreKey=definition.key==='location'?'publisherPlace':definition.key;const core=new Set(['title','year','language','publisher','publisherPlace','url','abstract','isbn']);if(core.has(coreKey)){field(definition.label,coreKey as any);return;}const label=document.createElement('label');label.className='property-field';const caption=document.createElement('span');caption.textContent=definition.label;const input=['note','annotation'].includes(definition.key)?document.createElement('textarea'):document.createElement('input');input.value=row.bibliographicFields[definition.key]||'';input.disabled=row.access==='viewer';input.addEventListener('change',()=>{const value=input.value.trim();if(value)row.bibliographicFields[definition.key]=value;else delete row.bibliographicFields[definition.key];refreshTable();scheduleSave(row);});label.append(caption,input);if(input instanceof HTMLInputElement&&['journaltitle','booktitle','maintitle','eventtitle','venue','institution','organization','school','series'].includes(definition.key)){attachMetadataSuggestions(input,label,()=>valueSuggestions(definition.key),(value)=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));});}form.appendChild(label);};
    const typeField = () => {
      const label = document.createElement('label'); label.className = 'property-field'; const caption = document.createElement('span'); caption.textContent = 'Type';
      const select = document.createElement('select'); select.disabled = row.access === 'viewer';
      BIBLATEX_ENTRY_TYPE_OPTIONS.forEach((entryType) => { const option = document.createElement('option'); option.value = entryType.value; option.textContent = entryType.label; option.title = entryType.description; option.selected = row.type === entryType.value; select.appendChild(option); });
      select.addEventListener('change',() => { row.type = normalizeBibliographicType(select.value); refreshTable(); scheduleSave(row); renderProperties(row.id); });
      label.append(caption,select); form.appendChild(label);
    };
    field('Title','title'); field('Cite key','citeKey'); typeField();
    const section = (title: string, addTitle: string, onAdd: () => void) => {
      const block = document.createElement('section'); block.className = 'property-section'; const header = document.createElement('header'); const label = document.createElement('span'); label.textContent = title;
      const add = document.createElement('button'); add.type = 'button'; add.textContent = '+'; add.title = addTitle; add.disabled = row.access === 'viewer'; add.addEventListener('click',onAdd); header.append(label,add); block.appendChild(header); form.appendChild(block); return block;
    };
    const people = section('Persons','Add or edit persons and their roles',() => openContributorEditor(row));
    row.contributors.forEach((person) => { const item = document.createElement('button'); item.type = 'button'; item.className = 'property-person'; item.disabled = row.access === 'viewer'; item.textContent = `${person.role || 'author'} · ${person.family || person.literal || ''}${person.given ? `, ${person.given}` : ''}`; item.addEventListener('click',() => openContributorEditor(row)); people.appendChild(item); });
    biblatexFieldsFor(row.type).filter((definition)=>definition.key!=='title').forEach(biblatexField);
    const keywords = section('Keywords','Keywords are managed in the cloud at left',() => undefined);
    keywords.querySelector('button')?.remove(); row.keywords.forEach((keyword) => { const token = document.createElement('div'); token.className = 'property-token'; const color = payload.keywordStyles[keyword]; if (color) token.style.boxShadow = `inset 3px 0 ${color}`; token.textContent = keyword; keywords.appendChild(token); });
    propertiesContent.appendChild(form);
  }

  const controller = {
    openCatalog() { addPanel('catalog', 'catalog', 'Catalog', 'within'); },
    openDocument(referenceId: string, split = false) {
      const phone=isPhoneLayout();if(phone){window.dispatchEvent(new CustomEvent('seshat:set-sidebar',{detail:{collapsed:true}}));root.classList.remove('properties-open');closePhoneAuxiliaryPanels();}
      activeReference = referenceId; const ref = references.get(referenceId); if (!ref) return; renderProperties(referenceId); if(!phone)root.classList.add('properties-open');
      lastRead[referenceId] = Date.now();
      window.localStorage.setItem(TREE_LAST_READ_KEY, JSON.stringify(lastRead));
      if (treeOrder === 'recent') renderTree(search.value);
      if (split&&!phone) { addPanel(`document-split-${referenceId}-${Date.now()}`, `document:${referenceId}`, ref.title, 'right'); return; }
      const existing = api.getPanel('document-preview');
      if (existing) { previewRender?.(referenceId); existing.api.setTitle(ref.title); existing.api.setActive(); }
      else addPanel('document-preview', 'document-preview', ref.title, 'right');
      if(phone)maximizePhonePanel('document-preview');
    },
    openDerivative(referenceId: string, kind: 'text' | 'structure') { const ref = references.get(referenceId);const panelId=`${kind}-${referenceId}`;closePhoneAuxiliaryPanels(panelId);addPanel(panelId, `${kind}:${referenceId}`, `${kind === 'text' ? 'Text' : 'Structure'} · ${ref?.title || ''}`, 'right');maximizePhonePanel(panelId); },
    openTool(kind: ToolKind, referenceId: string | null | undefined = activeReference || undefined) {
      const globalGraph = kind === 'graph' && referenceId === null;
      const effectiveReferenceId = globalGraph ? undefined : referenceId || undefined;
      const suffix = effectiveReferenceId || 'global';
      let title = kind === 'agent' ? 'AI agent' : kind[0].toUpperCase() + kind.slice(1);
      if (kind === 'graph') title = globalGraph ? 'Knowledge Graph' : 'Graph';
      if (kind === 'search') title = 'Corpus Search';
      if (kind === 'graph') {
        const panelId = globalGraph ? 'tool-knowledge-graph' : 'tool-graph';
        const existing = api.getPanel(panelId);
        if (existing) {
          if (effectiveReferenceId) window.dispatchEvent(new CustomEvent('seshat:active-reference-changed', { detail: { referenceId: effectiveReferenceId } }));
          existing.api.setActive();maximizePhonePanel(panelId);
          return;
        }
        closePhoneAuxiliaryPanels(panelId);addPanel(panelId, `tool:${kind}:${effectiveReferenceId || ''}`, title, 'right');maximizePhonePanel(panelId);
        return;
      }
      const panelId=`tool-${kind}-${suffix}`;closePhoneAuxiliaryPanels(panelId);addPanel(panelId, `tool:${kind}:${effectiveReferenceId || ''}`, title, 'right');maximizePhonePanel(panelId);
    },
    openBibliography(batchId: string, title = 'Bibliography') { const panelId=`bibliography-${batchId}`;closePhoneAuxiliaryPanels(panelId);addPanel(panelId, `bibliography:${batchId}`, title, 'right');maximizePhonePanel(panelId); },
  };

  async function deleteReference(referenceId: string) {
    const reference = references.get(referenceId);
    if (!reference) return;
    const timer = saveTimers.get(referenceId);
    if (timer) window.clearTimeout(timer);
    saveTimers.delete(referenceId);
    const activityId = `delete-${referenceId}`;
    updateActivity(activityId, { state: 'working', message: `${reference.title} · deleting catalog entry and Wasabi files` });
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
      updateActivity(activityId, { state: 'complete', message: `${reference.title} · deleted from catalog and Wasabi` });
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
  type ContextMenuItem={label:string;shortcut?:string;danger?:boolean;disabled?:boolean;swatch?:string;checked?:boolean;children?:ContextMenuItem[];action?:()=>void|Promise<void>};
  const openContextMenu = (event: MouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault(); event.stopPropagation(); closeContextMenu();
    const buildMenu=(entries:ContextMenuItem[],nested=false)=>{const menu = document.createElement('div'); menu.className = nested?'seshat-context-menu context-submenu':'seshat-context-menu'; menu.setAttribute('role', 'menu');
    entries.forEach((item) => {
      const wrap=document.createElement('div');wrap.className='context-menu-item';const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem');
      if (item.swatch) { const swatch = document.createElement('i'); swatch.className = 'context-swatch'; swatch.style.background = item.swatch; button.appendChild(swatch); }
      if(item.checked!==undefined){const check=document.createElement('i');check.className='context-check';check.textContent=item.checked?'✓':'';button.appendChild(check);}button.append(item.label);if(item.shortcut){const shortcut=document.createElement('kbd');shortcut.className='context-shortcut';shortcut.textContent=item.shortcut;button.appendChild(shortcut);}if(item.children?.length){const arrow=document.createElement('span');arrow.className='context-arrow';arrow.textContent='›';button.appendChild(arrow);wrap.append(button,buildMenu(item.children,true));}else wrap.appendChild(button);
      button.disabled = Boolean(item.disabled); button.classList.toggle('danger', Boolean(item.danger));
      if(item.action)button.addEventListener('click', () => { closeContextMenu(); void item.action?.(); }); menu.appendChild(wrap);
    });return menu;};
    const menu=buildMenu(items);
    root.appendChild(menu); contextMenu = menu;
    const bounds = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(event.clientX, window.innerWidth - bounds.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(event.clientY, window.innerHeight - bounds.height - 6))}px`;
  };
  document.addEventListener('pointerdown', (event) => { if (contextMenu && !contextMenu.contains(event.target as Node)) closeContextMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeContextMenu(); });
  window.addEventListener('blur', closeContextMenu);

  const keywordPalette = ['#e85d75','#e8953d','#d5b93f','#61a45f','#39a6a3','#578bd8','#8b70d6','#c45aa7'];
  const patchKeyword = async (action: 'color' | 'rename' | 'delete', keyword: string, value?: string) => {
    const response = await fetch('/api/library/keywords', { method:'PATCH', headers:{'content-type':'application/json'}, body:JSON.stringify({ action, keyword, value, color:value }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Keyword update failed');
    if (action === 'color' && value) payload.keywordStyles[keyword] = value;
    if (action === 'rename' && value) {
      payload.references.forEach((reference) => { reference.keywords = [...new Set(reference.keywords.map((item) => item === keyword ? value : item))]; });
      if (payload.keywordStyles[keyword]) payload.keywordStyles[value] = payload.keywordStyles[keyword];
      delete payload.keywordStyles[keyword]; if (activeKeyword === keyword) activeKeyword = value;
    }
    if (action === 'delete') {
      payload.references.forEach((reference) => { reference.keywords = reference.keywords.filter((item) => item !== keyword); });
      delete payload.keywordStyles[keyword]; if (activeKeyword === keyword) activeKeyword = null;
    }
    refreshTable(); renderTree(search.value); renderKeywordCloud();
  };
  const keywordMenuItems = (keyword: string) => [
    { label:'Rename keyword…', action:async () => { const next = await requestText('Rename keyword','Keyword',keyword); if (next && next !== keyword) { try { await patchKeyword('rename',keyword,next); setSaveState('keyword renamed'); } catch (error) { setSaveState(error instanceof Error ? error.message : 'Keyword update failed','error'); } } } },
    ...keywordPalette.map((color, index) => ({ label:`Assign color ${index + 1}`, swatch:color, action:async () => { try { await patchKeyword('color',keyword,color); setSaveState('keyword color saved'); } catch (error) { setSaveState(error instanceof Error ? error.message : 'Keyword update failed','error'); } } })),
    { label:'Delete keyword', danger:true, action:async () => { if (!window.confirm(`Delete “${keyword}” from every item?`)) return; try { await patchKeyword('delete',keyword); setSaveState('keyword deleted'); } catch (error) { setSaveState(error instanceof Error ? error.message : 'Keyword update failed','error'); } } },
  ];
  function renderKeywordCloud() {
    if (!keywordCloud) return;
    const query = normalize(keywordFilter?.value || ''); const counts = new Map<string,number>();
    payload.references.forEach((reference) => reference.keywords.forEach((keyword) => counts.set(keyword,(counts.get(keyword) || 0) + 1)));
    keywordCount && (keywordCount.textContent = String(counts.size)); keywordCloud.replaceChildren();
    [...counts].filter(([keyword]) => !query || normalize(keyword).includes(query)).sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0])).forEach(([keyword,count]) => {
      const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'keyword-chip'; chip.classList.toggle('active',activeKeyword === keyword); chip.title = `${count} item${count === 1 ? '' : 's'} · right-click to edit`;
      const color = payload.keywordStyles[keyword]; if (color) { const dot = document.createElement('i'); dot.className = 'keyword-dot'; dot.style.setProperty('--keyword-color',color); chip.appendChild(dot); }
      const label = document.createElement('span'); label.textContent = keyword; const total = document.createElement('small'); total.textContent = String(count); chip.append(label,total);
      chip.addEventListener('click',() => { activeKeyword = activeKeyword === keyword ? null : keyword; refreshTable(); renderTree(search?.value || ''); renderKeywordCloud(); });
      chip.addEventListener('contextmenu',(event) => openContextMenu(event,keywordMenuItems(keyword)));
      keywordCloud.appendChild(chip);
    });
  }

  const openSmartFolderEditor = (existing?: SmartFolderNode) => {
    const dialog = dialogShell(existing ? `Edit smart folder · ${existing.name}` : 'New smart folder'); dialog.classList.add('smart-folder-dialog');
    const form = document.createElement('form'); form.className = 'smart-folder-editor';
    const intro = document.createElement('p'); intro.textContent = 'All filled criteria are combined. Results update automatically whenever item metadata changes.';
    const fields = document.createElement('div'); fields.className = 'smart-folder-fields';
    const inputs = new Map<string, HTMLInputElement>();
    const addField = (key: string, labelText: string, value = '', options: { placeholder?: string; type?: string; step?: string; min?: string; suggestions?: () => MetadataSuggestion<string>[] } = {}) => {
      const label = document.createElement('label'); const caption = document.createElement('span'); caption.textContent = labelText;
      const input = document.createElement('input'); input.type = options.type || 'text'; input.value = value; input.placeholder = options.placeholder || ''; input.autocomplete = 'off';
      if (options.step) input.step = options.step; if (options.min) input.min = options.min;
      label.append(caption,input); if (options.suggestions) attachMetadataSuggestions(input,label,options.suggestions,(selected) => { input.value = selected; });
      fields.appendChild(label); inputs.set(key,input); return input;
    };
    const filters = existing?.filters || {};
    const name = addField('name','Folder name',existing?.name || '',{ placeholder:'e.g. Oxford · Ancient philosophy' }); name.required = true; name.maxLength = 160;
    addField('author','Author / person',filters.author || '',{ placeholder:'Name contains…', suggestions:() => contributorSuggestions().map((suggestion) => ({ label:suggestion.label,detail:suggestion.detail,value:suggestion.label })) });
    addField('publisher','Publisher',filters.publisher || '',{ placeholder:'Publisher contains…', suggestions:() => valueSuggestions('publisher') });
    addField('publication','Journal / publication',filters.publication || '',{ placeholder:'Journal, book or proceedings…', suggestions:() => valueSuggestions('publication') });
    addField('place','Place / venue',filters.place || '',{ placeholder:'Place contains…', suggestions:() => valueSuggestions('place') });
    addField('series','Series',filters.series || '',{ placeholder:'Series contains…', suggestions:() => valueSuggestions('series') });
    addField('language','Language',filters.language || '',{ placeholder:'e.g. es, en, de…', suggestions:() => valueSuggestions('language') });
    addField('yearFrom','Year from',filters.yearFrom === undefined ? '' : String(filters.yearFrom),{ type:'number', step:'1', placeholder:'Including BCE: -350' });
    addField('yearTo','Year up to',filters.yearTo === undefined ? '' : String(filters.yearTo),{ type:'number', step:'1', placeholder:'Inclusive' });
    addField('sizeMinMb','Minimum size (MB)',filters.sizeMinBytes === undefined ? '' : String(Math.round(filters.sizeMinBytes / 104857.6) / 10),{ type:'number', step:'0.1', min:'0' });
    addField('sizeMaxMb','Maximum size (MB)',filters.sizeMaxBytes === undefined ? '' : String(Math.round(filters.sizeMaxBytes / 104857.6) / 10),{ type:'number', step:'0.1', min:'0' });
    const status = document.createElement('p'); status.className = 'smart-folder-status'; status.setAttribute('aria-live','polite');
    const footer = document.createElement('footer'); const cancel = document.createElement('button'); cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',()=>dialog.close());
    const save = document.createElement('button'); save.type='submit';save.className='primary';save.textContent=existing?'Save smart folder':'Create smart folder';footer.append(cancel,save);
    form.append(intro,fields,status,footer); dialog.appendChild(form);
    form.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const raw:Record<string,unknown>={};
      for(const key of ['author','publisher','publication','place','series','language','yearFrom','yearTo']){const value=inputs.get(key)?.value.trim();if(value)raw[key]=value;}
      for(const [inputKey,filterKey] of [['sizeMinMb','sizeMinBytes'],['sizeMaxMb','sizeMaxBytes']] as const){const value=Number(inputs.get(inputKey)?.value);if(Number.isFinite(value)&&value>=0&&inputs.get(inputKey)?.value!=='')raw[filterKey]=Math.round(value*1024*1024);}
      const normalizedFilters=normalizeSmartFolderFilters(raw);if(!smartFolderHasFilters(normalizedFilters)){status.textContent='Add at least one filter.';status.dataset.tone='error';return;}
      save.disabled=true;status.textContent='Saving…';status.dataset.tone='';
      try{
        const response=await fetch(existing?`/api/smart-folders/${existing.id}`:'/api/smart-folders',{method:existing?'PATCH':'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name.value.trim(),filters:normalizedFilters})});
        const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not save smart folder.');
        const saved=result.smartFolder as SmartFolderNode;if(existing)Object.assign(existing,saved);else payload.smartFolders.push(saved);
        activeLibrary=null;activeVirtualFolder=null;activeSmartFolder=saved.id;refreshTable();renderTree(search.value);controller.openCatalog();setSaveState(existing?'smart folder updated':'smart folder created');dialog.close();
      }catch(error){save.disabled=false;status.textContent=error instanceof Error?error.message:'Could not save smart folder.';status.dataset.tone='error';}
    });
    window.requestAnimationFrame(()=>name.focus());
  };

  const deleteSmartFolder = async (folder: SmartFolderNode) => {
    if(!await confirmAction('Delete smart folder',`Delete “${folder.name}”? No references will be deleted.`,'Delete smart folder'))return;
    try{const response=await fetch(`/api/smart-folders/${folder.id}`,{method:'DELETE'});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'Could not delete smart folder.');
      payload.smartFolders=payload.smartFolders.filter((item)=>item.id!==folder.id);if(activeSmartFolder===folder.id)activeSmartFolder=null;refreshTable();renderTree(search.value);setSaveState('smart folder deleted');
    }catch(error){setSaveState(error instanceof Error?error.message:'Could not delete smart folder.','error');}
  };

  let lastTreeTap:{referenceId:string;time:number;x:number;y:number}|null=null;
  const renderTree = (query = '') => {
    tree.replaceChildren();
    const alphabetical = (left: string, right: string) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    const libraryLastRead = new Map<string, number>();
    payload.references.forEach((reference) => {
      const readAt = Number(lastRead[reference.id] || 0);
      if (!readAt) return;
      reference.libraryIds.forEach((libraryId) => libraryLastRead.set(libraryId, Math.max(readAt, libraryLastRead.get(libraryId) || 0)));
    });
    for (let pass = 0; pass < payload.libraries.length; pass += 1) {
      let changed = false;
      payload.libraries.forEach((library) => {
        if (!library.parentId) return;
        const readAt = libraryLastRead.get(library.id) || 0;
        if (readAt > (libraryLastRead.get(library.parentId) || 0)) { libraryLastRead.set(library.parentId, readAt); changed = true; }
      });
      if (!changed) break;
    }
    const sortLibraries = (left: LibraryNode, right: LibraryNode) => {
      if (treeOrder === 'za') return alphabetical(right.name, left.name);
      if (treeOrder === 'recent') return (libraryLastRead.get(right.id) || 0) - (libraryLastRead.get(left.id) || 0) || alphabetical(left.name, right.name);
      if (treeOrder === 'size') return right.itemCount - left.itemCount || alphabetical(left.name, right.name);
      return alphabetical(left.name, right.name);
    };
    const sortReferences = (left: ReferenceRow, right: ReferenceRow) => {
      if (treeOrder === 'za') return alphabetical(right.title, left.title);
      if (treeOrder === 'recent') return (lastRead[right.id] || 0) - (lastRead[left.id] || 0) || alphabetical(left.title, right.title);
      if (treeOrder === 'size') return right.sizeBytes - left.sizeBytes || alphabetical(left.title, right.title);
      return alphabetical(left.title, right.title);
    };
    const makeButton = (label: string, directCount: number, libraryId: string | null, recursiveCount = directCount, hideEmptyDirect = false) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'tree-node';
      button.classList.toggle('active', !activeSmartFolder && !activeVirtualFolder && activeLibrary === libraryId); button.dataset.libraryId = libraryId || '';
      const text = document.createElement('span'); text.textContent = label;
      const counts = document.createElement('span'); counts.className = 'tree-counts';
      if (!(hideEmptyDirect && directCount === 0)) {
        const direct = document.createElement('b'); direct.className = 'tree-count-direct'; direct.textContent = String(directCount); direct.title = 'Items directly in this collection'; counts.appendChild(direct);
      }
      const recursive = document.createElement('b'); recursive.className = 'tree-count-recursive'; recursive.textContent = String(recursiveCount); recursive.title = 'Items in this collection and all nested folders'; counts.appendChild(recursive);
      button.append(text, counts); button.addEventListener('click', () => { activeSmartFolder = null; activeVirtualFolder=null; activeLibrary = libraryId; refreshTable(); renderTree(search.value); controller.openCatalog(); });
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
    const children = (parentId?: string) => payload.libraries.filter((library) => (library.parentId || undefined) === parentId).sort(sortLibraries);
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
    const scanLibraryFolder = async (library: LibraryNode) => {
      const dialog=dialogShell(`Scan folder · ${library.name}`); dialog.classList.add('folder-scan-dialog'); const body=document.createElement('div'); body.className='folder-scan';
      const status=document.createElement('p'); status.textContent='Scanning the associated Wasabi folder…'; body.appendChild(status); dialog.appendChild(body); setSaveState('scanning Wasabi folder…','saving');
      try {
        const response=await fetch(`/api/libraries/${library.id}/scan`,{cache:'no-store'}); const result=await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Folder scan failed');
        status.textContent=`${result.candidates.length} unfiled object${result.candidates.length === 1 ? '' : 's'} · ${result.inspected} inspected`;
        const prefix=document.createElement('code'); prefix.textContent=result.prefix; body.appendChild(prefix);
        const list=document.createElement('div'); list.className='folder-scan-list'; (result.candidates || []).slice(0,200).forEach((candidate:any) => { const row=document.createElement('div'); const name=document.createElement('span'); name.textContent=candidate.filename; const size=document.createElement('small'); size.textContent=`${Math.max(1,Math.round(candidate.sizeBytes/1024))} KB`; row.append(name,size); list.appendChild(row); }); body.appendChild(list);
        const footer=document.createElement('footer'); const cancel=document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel'; cancel.addEventListener('click',() => dialog.close()); const importButton=document.createElement('button'); importButton.type='button'; importButton.className='primary'; importButton.textContent=`Import ${Math.min(200,result.candidates.length)}`; importButton.disabled=!result.candidates.length;
        importButton.addEventListener('click',async () => { importButton.disabled=true; importButton.textContent='Importing…'; setSaveState('importing Wasabi folder…','saving'); const importedResponse=await fetch(`/api/libraries/${library.id}/scan`,{method:'POST'}); const importedResult=await importedResponse.json().catch(() => ({})); if (!importedResponse.ok) { importButton.disabled=false; importButton.textContent='Try again'; status.textContent=importedResult.error || 'Folder import failed'; setSaveState(status.textContent,'error'); return; } (importedResult.imported || []).forEach((value:any) => { const row=rowFromCatalogReference(value); upsertRow(row); updateActivity(`folder-scan-${row.id}`,{state:'working',referenceId:row.id,message:`${row.filename} · linked from Wasabi; extracting`}); void followPipeline(row.id,`folder-scan-${row.id}`,row.filename); }); dialog.close(); setSaveState(`${importedResult.imported?.length || 0} Wasabi item${importedResult.imported?.length === 1 ? '' : 's'} imported`); });
        footer.append(cancel,importButton); body.appendChild(footer); setSaveState(`${result.candidates.length} unfiled Wasabi item${result.candidates.length === 1 ? '' : 's'} found`);
      } catch (error) { status.textContent=error instanceof Error ? error.message : 'Folder scan failed'; setSaveState(status.textContent,'error'); }
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
      const rows = isInboxLibraryId(library.id)
        ? payload.references.filter(isUnfiledReference)
        : payload.references.filter((reference) => reference.libraryIds.some((id) => branch.has(id)));
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
      const own = isInboxLibraryId(library.id)
        ? matched.filter(isUnfiledReference)
        : matched.filter((reference) => reference.libraryIds.includes(library.id));
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
      const recursiveIds = libraryBranchIds(library.id);
      const recursiveCount = isInboxLibraryId(library.id)
        ? own.length
        : matched.filter((reference) => reference.libraryIds.some((id) => recursiveIds.has(id))).length;
      libraryRow.appendChild(makeButton(library.name, own.length, library.id, recursiveCount, !library.parentId));
      const menuItems = () => {
        const items: Array<{ label: string; danger?: boolean; action: () => void | Promise<void> }> = [
          { label: 'Export as Better BibTeX (.bib)', action: () => exportLibrary(library) },
        ];
        if (library.access !== 'viewer' && !isInboxLibraryId(library.id)) items.unshift({ label: 'Scan folder for unfiled items', action: () => scanLibraryFolder(library) });
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
      const sortedReferences = own.sort(sortReferences);
      const visibleReferences = sortedReferences.slice(0, 100);
      const revealedReference = treeRevealReferenceId
        ? sortedReferences.find((reference) => reference.id === treeRevealReferenceId)
        : undefined;
      if (revealedReference && !visibleReferences.some((reference) => reference.id === revealedReference.id)) {
        visibleReferences.push(revealedReference);
      }
      visibleReferences.forEach((reference) => {
        const item = document.createElement('button'); item.type = 'button'; item.className = 'tree-reference'; item.title = reference.title; item.dataset.referenceId = reference.id;
        item.classList.toggle('selected', selectedReferences.has(reference.id));
        item.draggable = reference.access !== 'viewer';
        const kind = treeReferenceKind(reference);
        const glyph = document.createElement('span'); glyph.className = `tree-reference-glyph is-${kind}`;
        glyph.classList.toggle('needs-ocr', reference.needsOcr);
        glyph.classList.toggle('has-narration', reference.hasKokoroNarration||reference.hasChirpNarration);
        glyph.title = reference.needsOcr ? 'PDF needs OCR or usable extracted text' : ({ pdf: 'PDF', ebook: 'Ebook', text: 'Text available', 'no-text': 'No text available' } as const)[kind];
        glyph.setAttribute('aria-label', glyph.title);
        const title = document.createElement('span'); title.className='tree-reference-title'; title.textContent = reference.title; item.appendChild(glyph);
        const coloredKeyword = reference.keywords.find((keyword) => payload.keywordStyles[keyword]);
        if (coloredKeyword) { const dot = document.createElement('i'); dot.className = 'tree-keyword-dot'; dot.style.setProperty('--keyword-color',payload.keywordStyles[coloredKeyword]); dot.title = coloredKeyword; item.appendChild(dot); }
        if (isProcessingReference(reference)) {
          const spinner = document.createElement('i'); spinner.className = 'tree-spinner'; spinner.title = 'Processing…';
          item.classList.add('is-processing'); item.appendChild(spinner);
        }
        item.appendChild(title);
        if(reference.hasKokoroNarration||reference.hasChirpNarration){const provider=reference.hasKokoroNarration?'kokoro':'chirp';const play=document.createElement('span');play.className='tree-narration-play';play.textContent='▶';play.title=`Play rendered ${provider} narration`;play.setAttribute('aria-label',play.title);const activate=(event:Event)=>{event.preventDefault();event.stopPropagation();controller.openDocument(reference.id);window.setTimeout(()=>{const pod=root.querySelector<HTMLElement>(`.document-pod[data-reference-id="${CSS.escape(reference.id)}"]`);pod?.dispatchEvent(new CustomEvent('seshat:play-rendered',{detail:{provider}}));},60);};play.addEventListener('pointerdown',(event)=>event.stopPropagation());play.addEventListener('touchend',(event)=>event.stopPropagation(),{passive:true});play.addEventListener('click',activate);item.appendChild(play);}
        item.addEventListener('click', (event) => {
          if (event.detail > 1) return;
          if (event.shiftKey && treeSelectionAnchor) {
            const anchorIndex = visibleReferences.findIndex((item) => item.id === treeSelectionAnchor);
            const referenceIndex = visibleReferences.findIndex((item) => item.id === reference.id);
            if (anchorIndex >= 0 && referenceIndex >= 0) {
              if (!event.metaKey && !event.ctrlKey) selectedReferences.clear();
              const start = Math.min(anchorIndex, referenceIndex);
              const end = Math.max(anchorIndex, referenceIndex);
              visibleReferences.slice(start, end + 1).forEach((item) => selectedReferences.add(item.id));
            } else {
              selectedReferences.clear(); selectedReferences.add(reference.id);
              treeSelectionAnchor = reference.id;
            }
          } else if (event.metaKey || event.ctrlKey) {
            if (selectedReferences.has(reference.id)) selectedReferences.delete(reference.id);
            else selectedReferences.add(reference.id);
            treeSelectionAnchor = reference.id;
          } else {
            selectedReferences.clear(); selectedReferences.add(reference.id);
            treeSelectionAnchor = reference.id;
          }
          activeReference = reference.id; renderProperties(reference.id);
          syncTreeSelection();
          setSaveState(`${selectedReferences.size} selected`);
        });
        item.addEventListener('dblclick', (event) => controller.openDocument(reference.id, event.altKey));
        item.addEventListener('touchend', (event) => {
          if(event.changedTouches.length!==1)return;const touch=event.changedTouches[0];const now=Date.now();const previous=lastTreeTap;const isDouble=Boolean(previous&&previous.referenceId===reference.id&&now-previous.time<450&&Math.hypot(touch.clientX-previous.x,touch.clientY-previous.y)<28);
          if(isDouble){event.preventDefault();event.stopPropagation();lastTreeTap=null;controller.openDocument(reference.id);return;}
          lastTreeTap={referenceId:reference.id,time:now,x:touch.clientX,y:touch.clientY};
        }, { passive: false });
        item.addEventListener('contextmenu', (event) => {
          if (!selectedReferences.has(reference.id)) {
            selectedReferences.clear(); selectedReferences.add(reference.id); syncTreeSelection();
          }
          openContextMenu(event, referenceMenuItems(selectedIds(),library.id));
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
              selectedReferences.clear(); selectedReferences.add(reference.id); syncTreeSelection();
            }
            openContextMenu(event, referenceMenuItems(selectedIds(),library.id));
          }, 560);
        });
        item.addEventListener('pointermove', clearReferenceLongPress);
        item.addEventListener('pointerup', clearReferenceLongPress);
        item.addEventListener('pointercancel', clearReferenceLongPress);
        item.addEventListener('dragstart', (event) => {
          if (!selectedReferences.has(reference.id)) { selectedReferences.clear(); selectedReferences.add(reference.id); syncTreeSelection(); }
          const openIds=[...selectedReferences]; setOpenDragData(event.dataTransfer,openIds);
          const moveIds = openIds.filter((id) => references.get(id)?.access !== 'viewer');
          if (moveIds.length) { event.dataTransfer?.setData('application/x-seshat-references', JSON.stringify(moveIds)); event.dataTransfer?.setData('application/x-seshat-reference', moveIds[0]); }
          setSaveState(`${openIds.length} selected`);
        });
        nested.appendChild(item);
      });
      details.appendChild(nested); container.appendChild(details);
    };
    children().forEach((library) => appendLibrary(library, tree));
    const smartSection=document.createElement('section');smartSection.className='smart-folder-section';
    const smartHeader=document.createElement('header');const smartTitle=document.createElement('span');smartTitle.textContent='Smart folders';
    const addSmart=document.createElement('button');addSmart.type='button';addSmart.textContent='＋';addSmart.title='New smart folder';addSmart.setAttribute('aria-label','New smart folder');addSmart.addEventListener('click',()=>openSmartFolderEditor());smartHeader.append(smartTitle,addSmart);smartSection.appendChild(smartHeader);
    [...payload.smartFolders].sort((left,right)=>alphabetical(left.name,right.name)).forEach((folder)=>{
      const count=matched.filter((reference)=>referenceMatchesSmartFolder(reference,folder.filters)).length;
      const button=document.createElement('button');button.type='button';button.className='smart-folder-node';button.classList.toggle('active',activeSmartFolder===folder.id);button.title=`${folder.name} · ${count} matching item${count===1?'':'s'}`;
      const icon=document.createElement('span');icon.className='smart-folder-icon';icon.innerHTML='<svg viewBox="0 0 18 14" aria-hidden="true"><path d="M1.5 3.5h5l1.4-2h3.1l1.3 2h4.2v9H1.5z"/><path d="M5 7h8M5 9.5h5"/></svg>';
      const label=document.createElement('span');label.textContent=folder.name;const total=document.createElement('b');total.textContent=String(count);button.append(icon,label,total);
      button.addEventListener('click',()=>{activeLibrary=null;activeVirtualFolder=null;activeSmartFolder=folder.id;refreshTable();renderTree(search.value);controller.openCatalog();});
      button.addEventListener('contextmenu',(event)=>openContextMenu(event,[{label:'Edit smart folder…',action:()=>openSmartFolderEditor(folder)},{label:'Delete smart folder…',danger:true,action:()=>deleteSmartFolder(folder)}]));
      smartSection.appendChild(button);
    });
    const duplicateState=duplicateSnapshot();
    const duplicateButton=document.createElement('button');duplicateButton.type='button';duplicateButton.className='smart-folder-node virtual-folder-node duplicate-folder-node';duplicateButton.classList.toggle('active',activeVirtualFolder==='duplicates');duplicateButton.title=`${duplicateState.groups.length} duplicate group${duplicateState.groups.length===1?'':'s'} · ${duplicateState.ids.size} items · matches ignore entry type`;
    const duplicateIcon=document.createElement('span');duplicateIcon.className='smart-folder-icon';duplicateIcon.innerHTML='<svg viewBox="0 0 18 14" aria-hidden="true"><path d="M1.5 3.5h5l1.4-2h3.1l1.3 2h4.2v9H1.5z"/><rect x="5" y="6" width="6" height="4"/><rect x="7" y="4.5" width="6" height="4"/></svg>';
    const duplicateLabel=document.createElement('span');duplicateLabel.textContent='Duplicated';const duplicateTotal=document.createElement('b');duplicateTotal.textContent=String(duplicateState.ids.size);duplicateButton.append(duplicateIcon,duplicateLabel,duplicateTotal);
    duplicateButton.addEventListener('click',()=>{activeLibrary=null;activeSmartFolder=null;activeVirtualFolder='duplicates';activeKeyword=null;refreshTable();renderTree(search.value);renderKeywordCloud();controller.openCatalog();});
    duplicateButton.addEventListener('contextmenu',(event)=>{const ids=selectedIds();openContextMenu(event,[{label:'Merge selected duplicate group…',disabled:duplicateGroupFor(ids).length<2,action:()=>openDuplicateMerge(ids)},{label:`Delete selected items and files${ids.length>1?` (${ids.length})`:''}…`,disabled:!ids.length,danger:true,action:()=>deleteDuplicateSelection(ids)}]);});
    smartSection.appendChild(duplicateButton);
    tree.appendChild(smartSection);
    treeRevealReferenceId = null;
  };

  const locateReference = (referenceId: string | null) => {
    if(!referenceId)return;
    const reference=references.get(referenceId);if(!reference)return;
    const targetId=(activeLibrary&&reference.libraryIds.includes(activeLibrary)?activeLibrary:undefined)||reference.libraryIds.find((id)=>payload.libraries.some((library)=>library.id===id))||(isUnfiledReference(reference)?payload.libraries.find((library)=>isInboxLibraryId(library.id))?.id:undefined);
    activeSmartFolder=null;activeVirtualFolder=null;activeLibrary=targetId||null;
    if(targetId){let current=payload.libraries.find((library)=>library.id===targetId);while(current){collapsedLibraries.delete(current.id);current=current.parentId?payload.libraries.find((library)=>library.id===current!.parentId):undefined;}window.localStorage.setItem(TREE_STATE_KEY,JSON.stringify([...collapsedLibraries]));}
    activeReference=referenceId;selectedReferences.clear();selectedReferences.add(referenceId);treeSelectionAnchor=referenceId;
    search.value='';catalogQuery='';
    const catalogFilter=root.querySelector<HTMLInputElement>('.catalog-filter-bar input');if(catalogFilter)catalogFilter.value='';
    treeRevealReferenceId=referenceId;renderTree('');refreshTable();controller.openCatalog();
    let attempts=0;
    const reveal=()=>{
      attempts+=1;
      const escaped=CSS.escape(referenceId);
      const row=tree.querySelector<HTMLElement>(`[data-reference-id="${escaped}"]`);
      row?.scrollIntoView({block:'center',behavior:attempts===1?'smooth':'auto'});row?.focus({preventScroll:true});
      if(catalogTable){
        const physicalRow=visibleCatalogRows.findIndex((item)=>item.id===referenceId);
        const visualRow=physicalRow>=0?catalogTable.toVisualRow(physicalRow):-1;
        if(visualRow>=0){catalogTable.selectCell(visualRow,0);catalogTable.scrollViewportTo(visualRow,0);return;}
      }
      if(attempts<12)window.requestAnimationFrame(reveal);
    };
    window.requestAnimationFrame(reveal);
    setSaveState(targetId?`located in ${payload.libraries.find((library)=>library.id===targetId)?.name||'collection'}`:'located in catalog');
  };

  const locateSelectedReference = () => locateReference([...selectedReferences][0]||activeReference);

  const upsertRow = (next: ReferenceRow) => {
    const current = references.get(next.id);
    if (current) Object.assign(current, next);
    else { payload.references.unshift(next); references.set(next.id, next); }
    invalidateMetadataSuggestions();
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

  const pipelineFollowers = new Map<string, Promise<void>>();
  const MAX_PIPELINE_FOLLOWERS = 3;
  const runPipelineFollower = async (referenceId: string, activityId: string, filename: string) => {
    setProcessing(referenceId, true);
    let previousReference = '';
    try {
      for (let attempt = 0; attempt < 90; attempt += 1) {
        const response = await fetch(`/api/library/${referenceId}/status`, { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not read processing state.');
        const status = await response.json();
        const nextReference = JSON.stringify(status.reference || {});
        if (nextReference !== previousReference) {
          previousReference = nextReference;
          upsertRow(status.reference as ReferenceRow);
        }
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
        await wait(8000);
      }
      updateActivity(activityId, { state: 'error', message: `${filename} · processing continues in background` });
    } finally {
      setProcessing(referenceId, false);
    }
  };
  const followPipeline = (referenceId: string, activityId: string, filename: string): Promise<void> => {
    const existing = pipelineFollowers.get(referenceId);
    if (existing) return existing;
    if (pipelineFollowers.size >= MAX_PIPELINE_FOLLOWERS) {
      updateActivity(activityId, { state: 'complete', referenceId, message: `${filename} · queued; processing continues in background` });
      return Promise.resolve();
    }
    const follower = runPipelineFollower(referenceId, activityId, filename).finally(() => pipelineFollowers.delete(referenceId));
    pipelineFollowers.set(referenceId, follower);
    return follower;
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
    setSaveState('processing BibTeX…', 'saving');
    const form = new FormData(); files.forEach((file) => form.append('files', file, file.name));
    try {
      const response = await fetch('/api/bibliography/parse', { method: 'POST', body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not parse bibliography.');
      bibliographyFiles.set(activityId, files);
      window.sessionStorage.setItem(`seshat.bibliography.${activityId}`, JSON.stringify(result));
      controller.openBibliography(activityId, files.length === 1 ? files[0].name : 'Bibliography import');
      updateActivity(activityId, { state: 'complete', message: `${result.entries.length} references parsed · opened as pod` });
      setSaveState(`${result.entries.length} references ready`);
      window.setTimeout(() => setSaveState('ready'), 1800);
    } catch (error) {
      updateActivity(activityId, { state: 'error', message: error instanceof Error ? error.message : 'Bibliography parse failed' });
      setSaveState(error instanceof Error ? error.message : 'Bibliography parse failed', 'error');
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

  const openQuickfinder = () => {
    quickfinder?.remove();
    const overlay=document.createElement('div'); overlay.className='quickfinder-overlay'; quickfinder=overlay;
    const box=document.createElement('section'); box.className='quickfinder'; box.setAttribute('role','dialog'); box.setAttribute('aria-label','Quick finder');
    const prompt=document.createElement('div'); prompt.className='quickfinder-prompt'; const marker=document.createElement('b'); marker.textContent='›'; const input=document.createElement('input'); input.type='search'; input.autocomplete='off'; input.spellcheck=false; input.placeholder='Search items · prefix . for hybrid corpus search'; prompt.append(marker,input);
    const mode=document.createElement('div'); mode.className='quickfinder-mode'; const modeName=document.createElement('strong'); const modeHint=document.createElement('span'); mode.append(modeName,modeHint);
    const results=document.createElement('div'); results.className='quickfinder-results'; box.append(prompt,mode,results); overlay.appendChild(box); root.appendChild(overlay);
    type FinderResult={title:string;meta:string;snippet?:string;action:()=>void}; let found:FinderResult[]=[]; let selected=0; let timer=0; let request:AbortController|null=null;
    const close=() => { request?.abort(); window.clearTimeout(timer); overlay.remove(); if (quickfinder === overlay) quickfinder=null; };
    const draw=() => { results.replaceChildren(); if (!found.length) { const empty=document.createElement('p'); empty.className='quickfinder-empty'; empty.textContent=input.value.startsWith('.') ? 'No indexed evidence found.' : 'No matching items.'; results.appendChild(empty); return; } selected=Math.max(0,Math.min(selected,found.length-1)); found.forEach((item,index) => { const button=document.createElement('button'); button.type='button'; button.className='quickfinder-result'; button.classList.toggle('active',index === selected); const copy=document.createElement('span'); const title=document.createElement('strong'); title.textContent=item.title; const meta=document.createElement('small'); meta.textContent=item.meta; copy.append(title,meta); if (item.snippet) { const snippet=document.createElement('p'); snippet.textContent=item.snippet; copy.appendChild(snippet); } const indexLabel=document.createElement('i'); indexLabel.textContent=String(index+1).padStart(2,'0'); button.append(indexLabel,copy); button.addEventListener('mouseenter',() => { if (selected === index) return; selected=index; results.querySelectorAll('.quickfinder-result').forEach((row,rowIndex) => row.classList.toggle('active',rowIndex === selected)); }); button.addEventListener('click',() => {close();item.action();}); results.appendChild(button); }); results.querySelector('.active')?.scrollIntoView({block:'nearest'}); };
    const itemSearch=(query:string) => { modeName.textContent='ITEMS'; modeHint.textContent='Enter open · . corpus'; const needle=normalize(query); found=payload.references.map((reference) => { const haystack=normalize([reference.title,reference.contributorsDisplay,reference.citeKey,reference.tags,...reference.keywords].join(' ')); const index=needle ? haystack.indexOf(needle) : 0; let cursor=0; let gaps=0; if (needle && index < 0) { for (const character of needle) { const next=haystack.indexOf(character,cursor); if (next < 0) return null; gaps+=next-cursor; cursor=next+1; } } return { reference,score:index >= 0 ? index : 1000+gaps }; }).filter((value):value is {reference:ReferenceRow;score:number} => Boolean(value)).sort((left,right) => left.score-right.score || left.reference.title.localeCompare(right.reference.title)).slice(0,18).map(({reference}) => ({ title:reference.title,meta:`@${reference.citeKey} · ${reference.contributorsDisplay || reference.fileType}`,action:() => controller.openDocument(reference.id) })); selected=0;draw(); };
    const corpusSearch=async (query:string) => { modeName.textContent='CORPUS · HYBRID'; modeHint.textContent='lexical + semantic + graph'; if (query.length < 2) { found=[];draw();return; } request?.abort(); request=new AbortController(); modeHint.textContent='searching lexical + semantic + graph…'; try { const response=await fetch(`/api/search/corpus?${new URLSearchParams({q:query,mode:'hybrid'})}`,{signal:request.signal}); const data=await response.json(); if (!response.ok) throw new Error(data.error || 'Search failed'); found=(data.items || []).slice(0,24).map((item:any) => ({ title:item.title,meta:[item.locator || item.section || `@${item.citeKey}`,...(item.channels || [])].filter(Boolean).join(' · '),snippet:String(item.snippet || '').replaceAll('‹','').replaceAll('›',''),action:() => { controller.openDocument(item.referenceId); if (item.page) navigatePdfToPage(item.referenceId,item.page); } })); selected=0; modeHint.textContent=`${found.length} fragments · lexical + semantic + graph`;draw(); } catch (error) { if ((error as Error).name === 'AbortError') return; found=[];modeHint.textContent=error instanceof Error ? error.message : 'Search failed';draw(); } };
    const update=() => { const value=input.value; window.clearTimeout(timer); if (value.startsWith('.')) timer=window.setTimeout(() => void corpusSearch(value.slice(1).trim()),180); else {request?.abort();itemSearch(value);} };
    input.addEventListener('input',update); input.addEventListener('keydown',(event) => { event.stopPropagation(); if (event.key === 'Escape') {event.preventDefault();close();return;} if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {event.preventDefault();selected=(selected+(event.key === 'ArrowDown' ? 1 : -1)+Math.max(1,found.length))%Math.max(1,found.length);draw();return;} if (event.key === 'Enter' && found[selected]) {event.preventDefault();const action=found[selected].action;close();action();} });
    overlay.addEventListener('pointerdown',(event) => {if (event.target === overlay) close();}); itemSearch(''); window.requestAnimationFrame(() => input.focus());
  };

  const openHelp = () => {
    const dialog = dialogShell('Seshat help'); dialog.classList.add('workspace-help-dialog'); const body = document.createElement('div'); body.className = 'workspace-help';
    const addSection = (title: string, lines: string[]) => { const section = document.createElement('section'); const heading = document.createElement('h3'); heading.textContent = title; const list = document.createElement('ol'); lines.forEach((line) => { const item = document.createElement('li'); item.textContent = line; list.appendChild(item); }); section.append(heading,list); body.appendChild(section); };
    addSection('First steps',['Drop PDF, EPUB, DOCX, TXT or BIB files anywhere in the workspace.','Review a BIB preview, then create its collection tree and link existing Wasabi files.','Select an item to inspect properties; changing Entry type immediately selects its standard BibLaTeX fields.','Right-click a Catalog column header to show fields by group or change the sticky Title / Persons columns.','Double-click an item to read. Use Read for speech; Shift-click or long-press it to choose browser/Microsoft or Kokoro voices.','Rendered narrations have a blue ▶ in the collection sidebar and a ▶ OGG control in the document toolbar.','While speech is active, press M to save a durable reading mark.','Use GRAPH in an item toolbar for that document; use Knowledge Graph in the main bar for all references or one collection.','Use the Keywords cloud for Zotero/BibTeX keywords. Dashboard tags are general descriptive labels generated or edited independently.']);
    addSection('Shortcuts',['R — read / pause / resume','Shift R — read voice and engine settings','W — search Wasabi candidates for selected items','Shift W — link the first Wasabi match automatically','⌘ ; — open Dashboard','⌘ Backspace — delete selected items','Alt — reveal the open item in sidebar and Catalog','Alt L — locate selected item in its collection','g c — search Wasabi candidate','⌘ \\ — toggle collection sidebar','⌘ ⇧ \\ — reading / analysis view','z c / z o — fold / unfold current collection','z M / z R — fold / unfold all collections','y a / y b — copy APA / BibTeX','Reader: ← / → previous / next; 0 beginning; G end; PDF 1 fit page/spread, g grid, b book']);
    const bibliographyTypes=document.createElement('details');bibliographyTypes.className='help-bibliography-types';const bibliographySummary=document.createElement('summary');bibliographySummary.textContent='BibLaTeX entry types';const bibliographyIntro=document.createElement('p');bibliographyIntro.textContent='Type is controlled across Catalog and Item properties. Standard BibTeX types are supplemented by BibLaTeX/Biber media types and two explicit Seshat conventions.';const bibliographyList=document.createElement('div');BIBLATEX_ENTRY_TYPE_OPTIONS.forEach((entryType)=>{const row=document.createElement('div');const name=document.createElement('code');name.textContent=`@${entryType.value}`;const description=document.createElement('span');description.textContent=entryType.description;const target=document.createElement('small');target.textContent=entryType.value===entryType.biblatex?entryType.family:`exports @${entryType.biblatex}`;row.append(name,description,target);bibliographyList.appendChild(row);});bibliographyTypes.append(bibliographySummary,bibliographyIntro,bibliographyList);body.appendChild(bibliographyTypes);
    const technology = document.createElement('section'); const heading = document.createElement('h3'); heading.textContent = 'Applied technologies'; technology.appendChild(heading);
    const rows: Array<[string,string,string]> = [['Wasabi object storage','stable','Production-ready'],['Docling document extraction','stable','Production-ready'],['RapidOCR · ONNX Runtime','beta','Integrated, under broader validation'],['PostgreSQL catalog','stable','Production-ready'],['Qdrant semantic retrieval','beta','Integrated, under broader validation'],['Kokoro local TTS','beta','Local browser inference with Web Speech fallback'],['Knowledge graph','experimental','Active exploration'],['AI agent','planned','Planned capability']];
    rows.forEach(([name,state,title]) => { const row = document.createElement('div'); row.className = 'technology-row'; const led = document.createElement('i'); led.dataset.state = state; led.title = title; const label = document.createElement('span'); label.textContent = name; const status = document.createElement('small'); status.textContent = state; row.append(led,label,status); technology.appendChild(row); }); body.appendChild(technology); dialog.appendChild(body);
  };

  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const editing = target?.matches('input, textarea, select, [contenteditable="true"]')
      || Boolean(target?.closest('.handsontableInputHolder, .htEditor, [role="dialog"]'));
    if(event.key==='Alt'){altLocateArmed=!editing&&!event.repeat;return;}
    if(event.altKey)altLocateArmed=false;
    if (!editing && event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey && (event.code === 'Semicolon' || event.key === ';')) { event.preventDefault(); window.location.assign('/dashboard'); return; }
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.key === '?') { event.preventDefault(); openQuickfinder(); return; }
    if (!editing && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && event.key.toLowerCase()==='l') { event.preventDefault(); locateSelectedReference(); return; }
    if (!editing && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (shortcutPrefix) {
        const chord=`${shortcutPrefix}${event.key}`; shortcutPrefix=''; window.clearTimeout(shortcutPrefixTimer);
        if (chord === 'gc') { const id=[...selectedReferences][0] || activeReference; if (id) { event.preventDefault(); void searchForCandidate(id); } return; }
        if (chord === 'zc' || chord === 'zo' || chord === 'zM' || chord === 'zR') {
          event.preventDefault(); const collapse=chord === 'zc' || chord === 'zM'; const all=chord === 'zM' || chord === 'zR';
          if (all) { collapsedLibraries.clear(); if (collapse) payload.libraries.forEach((library) => collapsedLibraries.add(library.id)); }
          else if (activeLibrary) { if (collapse) collapsedLibraries.add(activeLibrary); else collapsedLibraries.delete(activeLibrary); }
          window.localStorage.setItem(TREE_STATE_KEY,JSON.stringify([...collapsedLibraries])); renderTree(search.value); setSaveState(collapse ? 'collections folded' : 'collections unfolded'); return;
        }
        if (chord === 'ya' || chord === 'yb') { event.preventDefault(); const ids=selectedReferences.size ? [...selectedReferences] : activeReference ? [activeReference] : []; copyReferences(ids,chord === 'ya' ? 'apa' : 'bibtex'); return; }
        return;
      }
      if (event.key.toLowerCase() === 'a' || event.key.toLowerCase() === 'b') {
        event.preventDefault(); const ids=selectedReferences.size ? [...selectedReferences] : activeReference ? [activeReference] : [];
        copyReferences(ids,event.key.toLowerCase()==='a'?'apa':'bibtex'); return;
      }
      if (event.key === 'g' || event.key === 'z' || event.key === 'y') {
        event.preventDefault(); shortcutPrefix=event.key; window.clearTimeout(shortcutPrefixTimer); setSaveState(`${event.key} …`);
        shortcutPrefixTimer=window.setTimeout(() => { shortcutPrefix=''; setSaveState('ready'); },1000); return;
      }
      if (event.key.toLowerCase() === 'w') {
        if(event.repeat)return;
        event.preventDefault();
        const ids=selectedReferences.size?[...selectedReferences]:activeReference?[activeReference]:[];
        void searchWasabiForSelection(ids,event.shiftKey);
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        const activePanelId=api.activePanel?.id;
        const activePod=activePanelId
          ? root.querySelector<HTMLElement>(`.document-pod[data-panel-id="${CSS.escape(activePanelId)}"]`)
          : null;
        const referencePod=activeReference
          ? root.querySelector<HTMLElement>(`.document-pod[data-reference-id="${CSS.escape(activeReference)}"]`)
          : null;
        const readButton=(activePod || referencePod || root.querySelector<HTMLElement>('.document-pod'))
          ?.querySelector<HTMLButtonElement>('.read-aloud-button');
        if (!readButton) { setSaveState('open an item before using Read','error'); return; }
        event.preventDefault();
        readButton.dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:event.shiftKey}));
        return;
      }
    }
    if (event.metaKey && event.shiftKey && !event.altKey && !event.ctrlKey && (event.code === 'Backslash' || event.key === '\\' || event.key === '|')) {
      if (editing) return;
      event.preventDefault();
      if (api.hasMaximizedGroup()) { api.exitMaximizedGroup(); if (activeReference) root.classList.add('properties-open'); }
      else {
        root.classList.remove('properties-open');
        const documentPanel = api.getPanel('document-preview');
        const panel = documentPanel || api.activePanel;
        if (documentPanel) documentPanel.api.setActive();
        if (panel) api.maximizeGroup(panel);
      }
      window.dispatchEvent(new Event('resize'));
      return;
    }
    if (event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey && event.key === 'Backspace') {
      if (editing) return;
      const ids = (selectedReferences.size ? [...selectedReferences] : activeReference ? [activeReference] : [])
        .filter((id) => references.get(id)?.access !== 'viewer');
      if (!ids.length) return;
      event.preventDefault();
      void deleteReferences(ids);
      return;
    }
  });
  document.addEventListener('keyup',(event)=>{
    if(event.key!=='Alt')return;
    const shouldLocate=altLocateArmed;altLocateArmed=false;
    const target=event.target as HTMLElement|null;
    const editing=target?.matches('input, textarea, select, [contenteditable="true"]')||Boolean(target?.closest('.handsontableInputHolder, .htEditor, [role="dialog"]'));
    if(!shouldLocate||editing)return;
    const activePanelId=api.activePanel?.id;
    const focusedReferenceId=activePanelId
      ? root.querySelector<HTMLElement>(`.document-pod[data-panel-id="${CSS.escape(activePanelId)}"]`)?.dataset.referenceId
      : undefined;
    event.preventDefault();locateReference(focusedReferenceId||activeReference||[...selectedReferences][0]||null);
  });
  window.addEventListener('blur',()=>{altLocateArmed=false;});

  consoleToggle.addEventListener('click', () => {
    const expanded = consoleDrawer.hidden;
    consoleDrawer.hidden = !expanded;
    consoleToggle.setAttribute('aria-expanded', String(expanded));
  });

  search.addEventListener('input', () => renderTree(search.value));
  treeOrderControl?.addEventListener('change', () => {
    treeOrder = (treeOrderControl.value || 'az') as TreeOrder;
    window.localStorage.setItem(TREE_ORDER_KEY, treeOrder);
    renderTree(search.value);
  });
  keywordFilter?.addEventListener('input', renderKeywordCloud);
  root.querySelector<HTMLButtonElement>('[data-workspace-help]')?.addEventListener('click',openHelp);
  root.querySelector<HTMLButtonElement>('[data-close-properties]')?.addEventListener('click',() => root.classList.remove('properties-open'));
  window.addEventListener('seshat:toggle-properties',((event: CustomEvent<{referenceId?:string}>) => { const id = event.detail?.referenceId || activeReference; const willOpen = !root.classList.contains('properties-open'); root.classList.toggle('properties-open',willOpen); if (willOpen && id) { activeReference = id; renderProperties(id); } window.dispatchEvent(new Event('resize')); }) as EventListener);
  root.querySelector<HTMLButtonElement>('[data-new-library]')?.addEventListener('click', async () => {
    const name = await requestText(activeLibrary ? 'Create folder' : 'Create library', 'Name', '', 'Create');
    if (!name) return;
    const response = await fetch('/api/libraries', { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ name, parentId: activeLibrary }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setSaveState(result.error || 'Could not create library', 'error'); return; }
    payload.libraries.push(result.library); renderTree(search.value); setSaveState('library created');
  });
  root.querySelectorAll<HTMLButtonElement>('[data-open-tool]').forEach((button) => button.addEventListener('click', () => {
    const kind = button.dataset.openTool as ToolKind;
    controller.openTool(kind, kind === 'graph' ? null : undefined);
  }));
  root.querySelector<HTMLButtonElement>('[data-zotero-sync]')?.addEventListener('click',async(event)=>{
    const button=event.currentTarget as HTMLButtonElement;const original=button.textContent||'Sync Zotero';button.disabled=true;button.textContent='Syncing…';setSaveState('synchronizing Zotero…','saving');
    try{
      const response=await fetch('/api/zotero/sync-now',{method:'POST'});const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error==='ZOTERO_SYNC_IN_PROGRESS'?'Zotero sync is already running':result.error||'Zotero sync failed');
      const processed=Number(result.pulled?.items||0)+Number(result.pushed?.items||0);setSaveState(`Zotero synchronized · ${processed} item${processed===1?'':'s'} processed`);button.textContent='Synced';window.setTimeout(()=>window.location.reload(),900);
    }catch(error){button.disabled=false;button.textContent=original;setSaveState(error instanceof Error?error.message:'Zotero sync failed','error');}
  });
  renderTree(); renderKeywordCloud(); renderProperties(activeReference);
}
