import { bibliographicFingerprint, isValidDoi, isValidIsbn } from './identifiers.js';
import type { BibliographicItem, HealthIssue, HealthReport } from './types.js';

const COST = {
  error: 30,
  warning: 12,
  info: 3,
} as const;

function issue(
  code: string,
  severity: HealthIssue['severity'],
  message: string,
  field?: string,
  suggestion?: string,
): HealthIssue {
  return { code, severity, message, field, suggestion };
}

export function evaluateReferenceHealth(
  item: BibliographicItem,
  evaluatedAt = new Date().toISOString(),
): HealthReport {
  const issues: HealthIssue[] = [];

  if (!item.title.trim()) {
    issues.push(issue('missing-title', 'error', 'The reference has no title.', 'title'));
  }

  if (!item.contributors.some((person) => person.role === 'author' || person.role === 'editor')) {
    issues.push(issue('missing-primary-contributor', 'warning', 'No author or editor is recorded.', 'contributors'));
  }

  if (!item.issued?.year) {
    issues.push(issue('missing-year', 'warning', 'No publication year is recorded.', 'issued.year'));
  } else if (item.issued.year < 1000 || item.issued.year > new Date().getUTCFullYear() + 1) {
    issues.push(issue('implausible-year', 'error', `Publication year ${item.issued.year} is implausible.`, 'issued.year'));
  }

  if (item.identifiers.doi && !isValidDoi(item.identifiers.doi)) {
    issues.push(issue('invalid-doi', 'error', 'The DOI is malformed.', 'identifiers.doi', 'Check the DOI against doi.org.'));
  }

  for (const isbn of item.identifiers.isbn ?? []) {
    if (!isValidIsbn(isbn)) {
      issues.push(issue('invalid-isbn', 'error', `ISBN ${isbn} has an invalid checksum.`, 'identifiers.isbn'));
    }
  }

  if (item.type === 'article-journal' && !item.containerTitle) {
    issues.push(issue('missing-container', 'warning', 'Journal article has no journal title.', 'containerTitle'));
  }

  if (!item.identifiers.doi && !(item.identifiers.isbn?.length) && !item.identifiers.url) {
    issues.push(issue('missing-stable-identifier', 'info', 'No DOI, ISBN, or canonical URL is recorded.', 'identifiers'));
  }

  if (!item.artifacts.some((artifact) => artifact.kind === 'original')) {
    issues.push(issue('missing-original', 'info', 'No original document is linked.', 'artifacts'));
  }

  const score = Math.max(0, 100 - issues.reduce((total, current) => total + COST[current.severity], 0));
  const status: HealthReport['status'] = issues.some((current) => current.severity === 'error')
    ? 'invalid'
    : issues.some((current) => current.severity === 'warning')
      ? 'needs-attention'
      : 'healthy';

  return {
    itemId: item.id,
    score,
    status,
    fingerprint: bibliographicFingerprint(item),
    issues,
    evaluatedAt,
  };
}

