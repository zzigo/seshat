import assert from 'node:assert/strict';
import test from 'node:test';
import { referenceVisualKind } from '../src/lib/reference-visual';

test('keeps DjVu visually distinct from PDF while sharing document behavior', () => {
  assert.equal(referenceVisualKind('pdf'), 'pdf');
  assert.equal(referenceVisualKind('djvu'), 'djvu');
  assert.equal(referenceVisualKind('djv'), 'djvu');
});

test('uses the workspace ebook and text visual vocabulary', () => {
  assert.equal(referenceVisualKind('epub'), 'ebook');
  assert.equal(referenceVisualKind('webarchive'), 'text');
  assert.equal(referenceVisualKind('', true), 'text');
});
