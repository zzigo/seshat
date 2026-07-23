import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = await readFile(new URL('../src/scripts/workspace.ts', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/styles/workspace.css', import.meta.url), 'utf8');

test('Hybrid Corpus Search inherits readable colors from the active theme', () => {
  assert.match(workspace,/searchInput\.className = 'corpus-pod-search-input'/);
  assert.match(workspace,/searchInput\.style\.color = 'var\(--ink\)'/);
  assert.match(workspace,/searchInput\.style\.background = 'var\(--field, var\(--paper-deep\)\)'/);
  assert.doesNotMatch(workspace,/searchInput\.style\.background = '#ffffff'/);
  assert.match(styles,/\.corpus-pod-search-input::placeholder\s*\{\s*color:var\(--muted\)/);
});
