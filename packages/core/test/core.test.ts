import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bibliographicFingerprint,
  biblatexEntryTypeFor,
  biblatexFieldsFor,
  evaluateReferenceHealth,
  generateCiteKey,
  isValidIsbn,
  normalizeDoi,
  normalizeBibliographicType,
  formatPublicationYear,
  parsePublicationYear,
  type BibliographicItem,
} from '../src/index.js';

const completeItem: BibliographicItem = {
  id: 'zotero:ABCD1234',
  citeKey: 'clarke2005ways',
  type: 'book',
  title: 'Ways of Listening',
  contributors: [{ family: 'Clarke', given: 'Eric', role: 'author' }],
  issued: { year: 2005 },
  publisher: 'Oxford University Press',
  identifiers: { isbn: ['9780195151947'] },
  tags: ['listening'],
  source: {
    provider: 'zotero',
    itemKey: 'ABCD1234',
    importedAt: '2026-06-30T00:00:00.000Z',
  },
  artifacts: [{
    id: 'artifact:original',
    kind: 'original',
    storage: { provider: 'wasabi', objectKey: 'bibliography/clarke2005.pdf' },
    createdAt: '2026-06-30T00:00:00.000Z',
  }],
  createdAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
};

test('normalizes DOI URLs', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1000/XYZ.123.'), '10.1000/xyz.123');
});

test('normalizes legacy catalog types into controlled BibLaTeX types', () => {
  assert.equal(normalizeBibliographicType('article-journal'), 'article');
  assert.equal(normalizeBibliographicType('musical-score'), 'score');
  assert.equal(biblatexEntryTypeFor('score'), 'misc');
  assert.equal(biblatexEntryTypeFor('performance'), 'performance');
});

test('selects BibLaTeX fields by entry type', () => {
  const article = new Set(biblatexFieldsFor('article').map((field) => field.key));
  const thesis = new Set(biblatexFieldsFor('phdthesis').map((field) => field.key));
  const recording = new Set(biblatexFieldsFor('recording').map((field) => field.key));
  assert.equal(article.has('journaltitle'), true);
  assert.equal(article.has('school'), false);
  assert.equal(thesis.has('school'), true);
  assert.equal(recording.has('userd'), true);
});

test('validates ISBN checksums', () => {
  assert.equal(isValidIsbn('978-0-19-515194-7'), true);
  assert.equal(isValidIsbn('978-0-19-515194-8'), false);
});

test('prefers stable identifiers for fingerprints', () => {
  assert.equal(bibliographicFingerprint(completeItem), 'isbn:9780195151947');
});

test('generates portable citekeys', () => {
  assert.equal(generateCiteKey(completeItem), 'clarke2005ways');
});

test('parses and validates BCE publication years without a year zero', () => {
  assert.equal(parsePublicationYear('-0350'), -350);
  assert.equal(parsePublicationYear('0350-00-00 -350'), -350);
  assert.equal(parsePublicationYear('350 BCE'), -350);
  assert.equal(parsePublicationYear('-350'), -350);
  assert.equal(parsePublicationYear('0'), undefined);
  assert.equal(formatPublicationYear(-350), '350 BCE');
  const report = evaluateReferenceHealth({ ...completeItem, issued: { year: -350 } }, '2026-06-30T00:00:00.000Z');
  assert.equal(report.issues.some((issue) => issue.code === 'implausible-year'), false);
});

test('reports a complete linked record as healthy', () => {
  const report = evaluateReferenceHealth(completeItem, '2026-06-30T00:00:00.000Z');
  assert.equal(report.status, 'healthy');
  assert.equal(report.score, 100);
  assert.deepEqual(report.issues, []);
});

test('reports malformed and incomplete metadata deterministically', () => {
  const report = evaluateReferenceHealth({
    ...completeItem,
    title: '',
    contributors: [],
    issued: { year: 3026 },
    identifiers: { doi: 'not-a-doi', isbn: ['1234'] },
    artifacts: [],
  }, '2026-06-30T00:00:00.000Z');

  assert.equal(report.status, 'invalid');
  assert.ok(report.score < 50);
  assert.deepEqual(
    report.issues.map((current) => current.code),
    ['missing-title', 'missing-primary-contributor', 'implausible-year', 'invalid-doi', 'invalid-isbn', 'missing-original'],
  );
});
