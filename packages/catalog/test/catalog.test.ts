import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBibliographyConnections, buildInitialJobs, type CatalogPaperRecord } from '../src/index.js';

test('creates an ordered, gated enrichment pipeline', () => {
  let index = 0;
  const jobs = buildInitialJobs('reference-1', () => `job-${++index}`);
  assert.deepEqual(jobs.map(({ stage, status }) => ({ stage, status })), [
    { stage: 'extract', status: 'queued' },
    { stage: 'scholarly', status: 'blocked' },
    { stage: 'identify', status: 'blocked' },
    { stage: 'summarize', status: 'blocked' },
    { stage: 'relate', status: 'blocked' },
  ]);
});

const paper = (referenceId: string, title: string, overrides: Partial<CatalogPaperRecord> = {}): CatalogPaperRecord => ({
  referenceId, ownerKey: 'owner', documentId: referenceId, fileHash: referenceId, title,
  normalizedTitle: title.toLowerCase(), extractedMetadata: {}, extractedReferences: [],
  resolutionStatus: 'unresolved', resolutionMethod: 'none', resolutionConfidence: 0,
  candidates: [], expansion: {}, provenance: {}, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', ...overrides,
});

test('connects extracted bibliography entries to catalogued and external papers', () => {
  const source = paper('source', 'Source paper', { extractedReferences: [
    { title: 'Known paper', year: 2020, confidence: .7 },
    { title: 'External paper', doi: '10.1234/external', confidence: .9 },
  ] });
  const known = paper('known', 'Known paper', { extractedMetadata: { publicationYear: 2020 } });
  const graph = buildBibliographyConnections(source, [source, known]);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes.find((node) => node.label === 'Known paper')?.properties.referenceId, 'known');
  assert.equal(graph.edges[0]?.kind, 'cites');
  assert.equal(graph.edges[0]?.evidence?.method, 'extracted-bibliography');
});
