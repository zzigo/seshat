import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceFileType } from '../src/lib/reference-file';

test('keeps PDF and EPUB reader routing distinct', () => {
  assert.equal(referenceFileType({ source:{ originalFilename:'paper.pdf' }, artifacts:[] }), 'pdf');
  assert.equal(referenceFileType({ source:{ originalFilename:'book.epub' }, artifacts:[] }), 'epub');
  assert.equal(referenceFileType({ artifacts:[{ kind:'original', mimeType:'application/pdf' }] }), 'pdf');
  assert.equal(referenceFileType({ artifacts:[{ kind:'original', mimeType:'application/epub+zip' }] }), 'epub');
});
