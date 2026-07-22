import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspaceCss = await readFile(new URL('../src/styles/workspace.css', import.meta.url), 'utf8');

test('catalog filter labels use the active Seshat text color', () => {
  assert.match(
    workspaceCss,
    /\.handsontable\.htDropdownMenu \.htUISelectAll a,[\s\S]*?\.handsontable\.htDropdownMenu \.htUIClearAll a,[\s\S]*?color:\s*var\(--ink\)\s*!important;/,
  );
  assert.match(
    workspaceCss,
    /\.handsontable\.htDropdownMenu \.htUIMultipleSelectHot td,[\s\S]*?color:\s*var\(--ink\)\s*!important;/,
  );
  assert.match(
    workspaceCss,
    /\.handsontable\.htDropdownMenu \.htUIMultipleSelectSearch input\s*\{[\s\S]*?color:\s*var\(--ink\)\s*!important;/,
  );
});
