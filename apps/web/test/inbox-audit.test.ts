import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInboxAudit } from '../src/lib/inbox-audit';

test('classifies unfiled local records and surfaces one exact-title Zotero candidate', () => {
  const audit = buildInboxAudit([
    { id: 'z1', title: 'L’écriture musicale', year: 2019, zoteroMapped: true, unfiled: false },
    { id: 'i1', title: 'L ECRITURE MUSICALE', year: 2018, sourceProvider: 'bibtex', zoteroMapped: false, unfiled: true },
    { id: 'i2', title: 'A local score', sourceProvider: 'bibtex', zoteroMapped: false, unfiled: true },
    { id: 'i3', title: 'Field recording', sourceProvider: 'upload', zoteroMapped: false, unfiled: true },
  ]);
  assert.deepEqual(audit.counts, { all: 3, possible: 1, bibtex: 1, uploads: 1, local: 0 });
  assert.equal(audit.byId.get('i1')?.candidateId, 'z1');
  assert.match(audit.byId.get('i1')?.label || '', /2018.*2019/);
});

test('does not suggest an ambiguous title shared by multiple Zotero records', () => {
  const audit = buildInboxAudit([
    { id: 'z1', title: 'Shared title', zoteroMapped: true, unfiled: false },
    { id: 'z2', title: 'Shared title', zoteroMapped: true, unfiled: false },
    { id: 'i1', title: 'Shared title', sourceProvider: 'bibtex', zoteroMapped: false, unfiled: true },
  ]);
  assert.equal(audit.counts.possible, 0);
  assert.equal(audit.byId.get('i1')?.kind, 'legacy-bibtex');
});
