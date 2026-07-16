import assert from 'node:assert/strict';
import test from 'node:test';
import { zoteroStyleAttachmentName } from '../src/lib/attachment-filename';

test('builds a Zotero-style firstCreator year title filename', () => {
  assert.equal(zoteroStyleAttachmentName({
    contributors: [{ family: 'Chiu', role: 'author' }, { family: 'Ahmad', role: 'author' }, { family: 'Sanusi', role: 'author' }],
    issued: { year: 2024 }, title: 'What are artificial intelligence literacy and competency?', currentFilename: 'old.PDF',
  }), 'Chiu et al._2024_What are artificial intelligence literacy and competency.pdf');
});

test('truncates the title component and removes unsafe path characters', () => {
  const result = zoteroStyleAttachmentName({ contributors: [{ family: 'A/B' }], issued: { year: 2025 }, title: 'x'.repeat(120), currentFilename: 'source.epub' });
  assert.equal(result, `A B_2025_${'x'.repeat(100)}.epub`);
});

test('uses underscores rather than wildcard characters between filename parts', () => {
  const result = zoteroStyleAttachmentName({
    contributors: [{ family: 'Magnusson' }], issued: { year: 2019 }, title: 'Ergodynamics', currentFilename: 'source.pdf',
  });
  assert.equal(result, 'Magnusson_2019_Ergodynamics.pdf');
  assert.equal(result.includes('*'), false);
});
