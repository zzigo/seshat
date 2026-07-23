import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { clampReaderPage } from '../src/lib/reader-page-input';
import { normalizeReaderSearchText, readerTextMatchOffsets } from '../src/lib/reader-search';

const pdf = await readFile(new URL('../src/scripts/pdf-viewer.ts', import.meta.url), 'utf8');
const epub = await readFile(new URL('../src/scripts/epub-reader.ts', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../src/scripts/workspace.ts', import.meta.url), 'utf8');
const modal = await readFile(new URL('../src/components/ReaderModal.astro', import.meta.url), 'utf8');
const dashboardReader = await readFile(new URL('../src/pages/dashboard-reader/[id].astro', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/workspace.css', import.meta.url), 'utf8');

test('normalizes and counts repeated reader search matches',()=>{
  assert.equal(normalizeReaderSearchText('  Música\n  NEGRA '),'música negra');
  assert.deepEqual(readerTextMatchOffsets('Alpha beta alpha BETA','alpha'),[0,11]);
  assert.deepEqual(readerTextMatchOffsets('one one one','one',2),[0,4]);
});

test('keeps direct page navigation inside the document range',()=>{
  assert.equal(clampReaderPage(-20,90),1);
  assert.equal(clampReaderPage(45,90),45);
  assert.equal(clampReaderPage(900,90),90);
  assert.match(workspace,/mountReaderPageInput\(pageIndicator/);
  assert.match(modal,/mountReaderPageInput\(readerPage/);
  assert.match(dashboardReader,/mountReaderPageInput\(page/);
  assert.match(dashboardReader,/command==='goto-page'/);
});

test('searches PDF, DjVu and EPUB readers from keyboard and mobile controls',()=>{
  assert.match(workspace,/reader-search-trigger/);
  assert.match(workspace,/\['pdf','djvu','djv','epub'\]\.includes/);
  assert.match(modal,/data-reader-command="search"/);
  assert.match(modal,/data-reader-format="text"\] \.reader-search-command/);
  assert.match(pdf,/parent\.addEventListener\('seshat:reader-search',handleReaderSearch\)/);
  assert.match(epub,/pod\?\.addEventListener\('seshat:reader-search',handleReaderSearch\)/);
  assert.match(epub,/event\.key\.toLowerCase\(\)==='f'/);
  assert.match(styles,/\.reader-search-panel\s*\{/);
});

test('returns from PDF grid to the explicitly selected page',()=>{
  assert.match(pdf,/classList\.toggle\('is-grid-selected'/);
  assert.match(pdf,/mode:grid\?'page':'grid'/);
  assert.match(pdf,/detail:\{mode:'page',page:selectedGridPage\}/);
  assert.match(workspace,/event\.detail\?\.mode === 'page'/);
  assert.match(styles,/\.seshat-pdf-pages\.mosaic-page-view \.seshat-pdf-page\.is-grid-selected/);
});
