import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDoclingChunk, reciprocalRankFusion, stableChunkId } from '../src/index.js';

test('stable chunk ids are deterministic Qdrant-compatible UUIDs', () => {
  const id = stableChunkId('reference-1', 3, 'A durable scholarly fragment.');
  assert.equal(id, stableChunkId('reference-1', 3, 'A durable scholarly fragment.'));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(id, stableChunkId('reference-1', 4, 'A durable scholarly fragment.'));
});

test('normalizes Docling provenance into a page-addressable chunk', () => {
  const chunk = normalizeDoclingChunk('reference-1', 0, {
    text: 'Situated evidence.',
    metadata: { headings: ['Introduction'], doc_items: [{ prov: [{ page_no: 7 }] }] },
  });
  assert.equal(chunk?.page, 7);
  assert.equal(chunk?.locator, 'p. 7');
  assert.equal(chunk?.section, 'Introduction');
});

test('RRF preserves channel provenance and rewards overlap', () => {
  const fused = reciprocalRankFusion([
    [{ chunkId: 'a', score: 1, channel: 'lexical' }, { chunkId: 'b', score: .8, channel: 'lexical' }],
    [{ chunkId: 'b', score: .9, channel: 'vector' }, { chunkId: 'c', score: .7, channel: 'vector' }],
  ]);
  assert.equal(fused[0].chunkId, 'b');
  assert.deepEqual(new Set(fused[0].channels), new Set(['lexical', 'vector']));
});
