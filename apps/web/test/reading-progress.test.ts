import assert from 'node:assert/strict';
import test from 'node:test';
import { readingIsComplete, readingProgress, readingProgressPercent, updateReadingLocation } from '../src/lib/reading-progress';

test('derives PDF and EPUB reading progress from their native positions', () => {
  assert.equal(readingProgress({lastPage:25,totalPages:100}),.25);
  assert.equal(readingProgressPercent({fraction:.426}),43);
  assert.equal(readingProgress({progress:2}),1);
});

test('records completion once without losing it when the reader moves backwards', () => {
  const completed=updateReadingLocation({page:9,totalPages:10},{page:10,lastPage:10,totalPages:10},'2026-07-15T10:00:00.000Z');
  assert.equal(completed.progress,1);assert.equal(completed.completedAt,'2026-07-15T10:00:00.000Z');assert.equal(readingIsComplete(completed),true);
  const revisited=updateReadingLocation(completed,{page:3,lastPage:3,totalPages:10},'2026-07-16T10:00:00.000Z');
  assert.equal(revisited.progress,.3);assert.equal(revisited.completedAt,completed.completedAt);assert.equal(readingIsComplete(revisited),true);
});
