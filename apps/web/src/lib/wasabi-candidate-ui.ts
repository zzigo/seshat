import { openWasabiOrphanDialog } from './wasabi-orphan-ui';

export type WasabiCandidate = {
  key: string;
  filename: string;
  path: string;
  sizeBytes: number;
  lastModified?: string;
  score: number;
};

type CandidateSearch = {
  candidates?: WasabiCandidate[];
  folder?: string;
  root?: string;
  scanned?: number;
  error?: string;
};

type CandidateOptions = {
  referenceId: string;
  title: string;
  report?: (message: string, kind?: 'saving' | 'success' | 'error') => void;
  onLinked?: (candidate: WasabiCandidate) => void;
};
type WasabiLinkResult = { error?:string; replaced?:Array<{key:string;filename:string;provider:string}>; sanitizePaths?:string[] };

const bytesLabel = (value: number) => value >= 1_000_000_000
  ? `${(value / 1_000_000_000).toFixed(1)} GB`
  : value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)} MB`
    : value >= 1_000
      ? `${Math.round(value / 1_000)} KB`
      : value ? `${value} B` : '';

const toast = (message: string, kind: 'saving' | 'success' | 'error' = 'success') => {
  document.querySelector('[data-wasabi-toast]')?.remove();
  const output = document.createElement('output');
  output.className = 'wasabi-candidate-toast';
  output.dataset.wasabiToast = '';
  output.dataset.kind = kind;
  output.textContent = message;
  document.body.appendChild(output);
  window.setTimeout(() => output.remove(), kind === 'error' ? 5200 : 3000);
};

const reporter = (options: CandidateOptions) => options.report || toast;

export const findWasabiCandidates = async (referenceId: string): Promise<CandidateSearch> => {
  const response = await fetch(`/api/library/${encodeURIComponent(referenceId)}/candidates`, { cache: 'no-store' });
  const result = await response.json().catch(() => ({})) as CandidateSearch;
  if (!response.ok) throw new Error(result.error || 'Wasabi candidates could not be loaded.');
  return result;
};

export const linkWasabiCandidate = async (referenceId: string, candidate: WasabiCandidate) => {
  const response = await fetch(`/api/library/${encodeURIComponent(referenceId)}/candidates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: candidate.key }),
  });
  const result = await response.json().catch(() => ({})) as WasabiLinkResult;
  if (!response.ok) throw new Error(result.error || 'The Wasabi file could not be linked.');
  window.dispatchEvent(new CustomEvent('seshat:wasabi-linked', { detail: { referenceId, candidate } }));
  return result;
};

export const autoLinkFirstWasabiCandidate = async (options: CandidateOptions) => {
  const report = reporter(options);
  report('Searching this item folder in Wasabi…', 'saving');
  try {
    const result = await findWasabiCandidates(options.referenceId);
    const candidate = result.candidates?.[0];
    if (!candidate) throw new Error('No plausible Wasabi candidate was found in this item folder.');
    report(`Linking ${candidate.filename}…`, 'saving');
    const linked=await linkWasabiCandidate(options.referenceId, candidate);
    report(`Linked ${candidate.filename}`, 'success');
    options.onLinked?.(candidate);
    if(linked.replaced?.length)void openWasabiOrphanDialog({paths:linked.sanitizePaths,title:`Replaced file · ${options.title}`,report});
  } catch (error) {
    report(error instanceof Error ? error.message : 'Wasabi auto-link failed.', 'error');
  }
};

export const openWasabiCandidateDialog = async (options: CandidateOptions) => {
  document.querySelector<HTMLDialogElement>('[data-wasabi-candidate-dialog]')?.close();
  const report = reporter(options);
  const dialog = document.createElement('dialog');
  dialog.className = 'wasabi-candidate-dialog';
  dialog.dataset.wasabiCandidateDialog = '';
  const form = document.createElement('form');
  form.method = 'dialog';
  const header = document.createElement('header');
  const heading = document.createElement('div');
  const eyebrow = document.createElement('small');
  eyebrow.textContent = 'SEARCH CANDIDATE';
  const title = document.createElement('strong');
  title.textContent = options.title;
  title.title = options.title;
  heading.append(eyebrow, title);
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.ariaLabel = 'Close candidates';
  close.addEventListener('click', () => dialog.close());
  header.append(heading, close);
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.placeholder = 'Filter filenames or paths…';
  filter.ariaLabel = 'Filter Wasabi candidates';
  const status = document.createElement('output');
  status.value = 'Searching this item folder…';
  const list = document.createElement('div');
  list.className = 'wasabi-candidate-list';
  form.append(header, filter, status, list);
  dialog.appendChild(form);
  (document.fullscreenElement || document.body).appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  dialog.showModal();

  try {
    const result = await findWasabiCandidates(options.referenceId);
    const candidates = result.candidates || [];
    status.value = `${candidates.length} candidate${candidates.length === 1 ? '' : 's'} · ${result.folder || result.root || 'Wasabi root'}`;
    const render = () => {
      const needle = filter.value.trim().toLocaleLowerCase();
      list.replaceChildren();
      const visible = candidates.filter((candidate) => !needle || `${candidate.filename} ${candidate.path}`.toLocaleLowerCase().includes(needle));
      visible.forEach((candidate) => {
        const button = document.createElement('button');
        button.type = 'button';
        const copy = document.createElement('span');
        const name = document.createElement('strong');
        name.textContent = candidate.filename;
        const path = document.createElement('small');
        path.textContent = candidate.path;
        copy.append(name, path);
        const facts = document.createElement('span');
        facts.textContent = [candidate.score ? `score ${candidate.score}` : '', bytesLabel(candidate.sizeBytes)].filter(Boolean).join(' · ');
        button.append(copy, facts);
        button.addEventListener('click', async () => {
          button.disabled = true;
          status.value = `Linking ${candidate.filename}…`;
          try {
            const linked=await linkWasabiCandidate(options.referenceId, candidate);
            options.onLinked?.(candidate);
            dialog.close();
            report(`Linked ${candidate.filename}`, 'success');
            if(linked.replaced?.length)void openWasabiOrphanDialog({paths:linked.sanitizePaths,title:`Replaced file · ${options.title}`,report});
          } catch (error) {
            button.disabled = false;
            status.value = error instanceof Error ? error.message : 'The Wasabi file could not be linked.';
          }
        });
        list.appendChild(button);
      });
      if (!visible.length) {
        const empty = document.createElement('p');
        empty.textContent = candidates.length ? 'No candidates match this filter.' : 'No plausible candidates were found in this item folder.';
        list.appendChild(empty);
      }
    };
    filter.addEventListener('input', render);
    render();
    filter.focus();
  } catch (error) {
    status.value = error instanceof Error ? error.message : 'Wasabi candidates could not be loaded.';
    report(status.value, 'error');
  }
};
