import assert from 'node:assert/strict';
import test from 'node:test';
import { lastReadTimestamp, sortRecentlyRead } from '../src/lib/recently-read';

test('keeps every valid reading and orders newest first', () => {
  const readings = sortRecentlyRead([
    { id: 'old', lastReadAt: '2025-04-02T10:00:00.000Z' },
    { id: 'never', lastReadAt: null },
    { id: 'new', lastReadAt: '2026-07-22T18:00:00.000Z' },
    { id: 'middle', lastReadAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(readings.map((reading) => reading.id), ['new', 'middle', 'old']);
});

test('treats invalid dates as unread', () => {
  assert.equal(lastReadTimestamp('not-a-date'), 0);
  assert.equal(sortRecentlyRead([{ lastReadAt: '' }, { lastReadAt: 'not-a-date' }]).length, 0);
});

