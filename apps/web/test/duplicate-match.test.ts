import assert from 'node:assert/strict';
import test from 'node:test';
import { referencesShareDuplicateEvidence } from '../src/lib/duplicate-match.js';

const base = {
  title: 'Peer and AI Review + Reflection (PAIRR): A human-centered approach to formative assessment',
  issued: { year: 2025 },
  contributors: [{ family: 'Sperber', given: 'M', role: 'author' as const }],
  identifiers: {},
};

test('accepts a source DOI shared across records even when one primary DOI conflicts', () => {
  assert.equal(referencesShareDuplicateEvidence([
    {
      ...base,
      identifiers: { doi: '10.1007/978-3-031-57892-2_16' },
      source: { biblatexFields: { doi: '10.1007/978-3-031-57892-2_16' } },
    },
    {
      ...base,
      identifiers: { doi: '10.1007/978-3-031-57892-2' },
      source: { bibtex: { doi: '10.1007/978-3-031-57892-2_16' } },
    },
  ]), true);
});

test('accepts strong metadata when only one duplicate record has a DOI', () => {
  assert.equal(referencesShareDuplicateEvidence([
    base,
    { ...base, title: 'Peer and AI Review + Reflection (PAIRR): A human-centered', identifiers: { doi: '10.1016/j.compcom.2025.102921' } },
  ]), true);
});

test('does not bridge conflicting stable identifiers using metadata alone', () => {
  assert.equal(referencesShareDuplicateEvidence([
    { ...base, identifiers: { doi: '10.1000/example.one' } },
    { ...base, identifiers: { doi: '10.1000/example.two' } },
  ]), false);
});
