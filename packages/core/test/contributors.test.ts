import assert from 'node:assert/strict';
import test from 'node:test';
import { contributorSummary, normalizeContributor } from '../src/contributors.js';

test('preserves institutions as literal contributors', () => {
  assert.deepEqual(normalizeContributor('Harvard University', { inferSimpleNames: true }), { literal: 'Harvard University', role: 'author' });
});

test('splits comma and simple provider names conservatively', () => {
  assert.deepEqual(normalizeContributor('Pei, Eujin'), { family: 'Pei', given: 'Eujin', role: 'author' });
  assert.deepEqual(normalizeContributor('Eujin Pei', { inferSimpleNames: true }), { family: 'Pei', given: 'Eujin', role: 'author' });
  assert.deepEqual(normalizeContributor('Ludwig van Beethoven', { inferSimpleNames: true }), { family: 'van Beethoven', given: 'Ludwig', role: 'author' });
});

test('summarizes multiple roles without flattening the data', () => {
  assert.equal(contributorSummary([
    { family: 'Pei', given: 'Eujin', role: 'author' },
    { family: 'Becker', given: 'Kurt', role: 'author' },
    { family: 'Dupont', given: 'Marie', role: 'translator' },
  ]), 'Pei, Eujin; Becker, Kurt · translator');
});
