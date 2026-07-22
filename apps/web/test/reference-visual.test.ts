import assert from 'node:assert/strict';
import test from 'node:test';
import { bibliographicVisualKind, referenceLinkState, referenceProcessKinds, referenceVisualKind } from '../src/lib/reference-visual';

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

test('groups bibliographic item types without confusing them with file formats', () => {
  assert.equal(bibliographicVisualKind('article'),'paper');
  assert.equal(bibliographicVisualKind('incollection'),'book');
  assert.equal(bibliographicVisualKind('score'),'score');
  assert.equal(bibliographicVisualKind('music'),'recording');
  assert.equal(bibliographicVisualKind('performance'),'performance');
  assert.equal(bibliographicVisualKind('phdthesis'),'thesis');
  assert.equal(bibliographicVisualKind('techreport'),'report');
});

test('returns only completed document processes in a stable order', () => {
  assert.deepEqual(referenceProcessKinds({hasOpenAlex:true,hasAnnotations:false,hasText:true,hasStructure:true}),['openalex','text','structure']);
});

test('distinguishes records without an associated file from linked documents',()=>{
  assert.equal(referenceLinkState({hasOriginal:false}),'unlinked');
  assert.equal(referenceLinkState({hasOriginal:true}),'linked');
});
