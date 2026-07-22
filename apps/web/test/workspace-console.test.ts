import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/pages/workspace.astro',import.meta.url),'utf8');
const script = readFileSync(new URL('../src/scripts/workspace.ts',import.meta.url),'utf8');
const styles = readFileSync(new URL('../src/styles/workspace.css',import.meta.url),'utf8');

test('keeps Activity hidden until Control plus backtick toggles the full console', () => {
  assert.match(page,/data-workspace-console hidden/);
  assert.match(script,/event\.ctrlKey.*event\.code==='Backquote'/);
  assert.doesNotMatch(script,/event\.altKey.*event\.key\.toLowerCase\(\)==='f'/);
  assert.match(styles,/\.workspace-console\[hidden\]\s*\{\s*display:none !important;/);
});
