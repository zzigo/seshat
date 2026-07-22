export type InboxAuditInput = {
  id: string;
  title: string;
  year?: string | number | null;
  sourceProvider?: string | null;
  zoteroMapped: boolean;
  unfiled: boolean;
};

export type InboxAuditKind = 'possible-zotero-match' | 'legacy-bibtex' | 'manual-upload' | 'local-only';

export type InboxAuditRecord = {
  id: string;
  kind: InboxAuditKind;
  label: string;
  candidateId?: string;
  candidateTitle?: string;
};

export type InboxAuditSnapshot = {
  records: InboxAuditRecord[];
  byId: Map<string, InboxAuditRecord>;
  counts: { all: number; possible: number; bibtex: number; uploads: number; local: number };
};

export const normalizeInboxAuditTitle = (value: unknown): string => String(value ?? '')
  .normalize('NFKD')
  .replace(/\p{M}/gu, '')
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

const yearLabel = (value: InboxAuditInput['year']): string => String(value ?? '').trim() || 'no year';

export const buildInboxAudit = (references: InboxAuditInput[]): InboxAuditSnapshot => {
  const mappedByTitle = new Map<string, InboxAuditInput[]>();
  for (const reference of references.filter((item) => item.zoteroMapped)) {
    const title = normalizeInboxAuditTitle(reference.title);
    if (title.length < 8) continue;
    mappedByTitle.set(title, [...(mappedByTitle.get(title) || []), reference]);
  }

  const records = references.filter((reference) => reference.unfiled && !reference.zoteroMapped).map((reference): InboxAuditRecord => {
    const title = normalizeInboxAuditTitle(reference.title);
    const candidates = title.length >= 8 ? mappedByTitle.get(title) || [] : [];
    if (candidates.length === 1) {
      const candidate = candidates[0];
      return {
        id: reference.id,
        kind: 'possible-zotero-match',
        label: `Possible Zotero match · ${yearLabel(reference.year)} ↔ ${yearLabel(candidate.year)}`,
        candidateId: candidate.id,
        candidateTitle: candidate.title,
      };
    }
    const provider = String(reference.sourceProvider || '').trim().toLocaleLowerCase();
    if (provider === 'bibtex') return { id: reference.id, kind: 'legacy-bibtex', label: 'Legacy BibTeX · local only' };
    if (provider === 'upload') return { id: reference.id, kind: 'manual-upload', label: 'Manual upload · local only' };
    return { id: reference.id, kind: 'local-only', label: 'Local only · no Zotero mapping' };
  });
  const byId = new Map(records.map((record) => [record.id, record]));
  return {
    records,
    byId,
    counts: {
      all: records.length,
      possible: records.filter((record) => record.kind === 'possible-zotero-match').length,
      bibtex: records.filter((record) => record.kind === 'legacy-bibtex').length,
      uploads: records.filter((record) => record.kind === 'manual-upload').length,
      local: records.filter((record) => record.kind === 'local-only').length,
    },
  };
};
