import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInitialJobs } from '../src/index.js';

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
