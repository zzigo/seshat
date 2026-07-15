import assert from 'node:assert/strict';
import test from 'node:test';
import { epubDocumentAppearance, epubDocumentThemeCss } from '../src/lib/epub-appearance';

test('EPUB themes always provide an opaque document background', () => {
  assert.equal(epubDocumentAppearance(false).background, '#f5f1e8');
  assert.equal(epubDocumentAppearance(true).background, '#111513');
  assert.match(epubDocumentThemeCss(false), /background-color:#f5f1e8!important/);
  assert.match(epubDocumentThemeCss(true), /background-color:#111513!important/);
});
