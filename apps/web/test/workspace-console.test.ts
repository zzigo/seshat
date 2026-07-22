import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../src/pages/workspace.astro',import.meta.url),'utf8');
const script = readFileSync(new URL('../src/scripts/workspace.ts',import.meta.url),'utf8');
const styles = readFileSync(new URL('../src/styles/workspace.css',import.meta.url),'utf8');

test('keeps Activity hidden until Shift C or the header icon toggles the full console', () => {
  assert.match(page,/data-workspace-console hidden/);
  assert.match(page,/data-workspace-console-button/);
  assert.match(script,/event\.shiftKey.*event\.code==='KeyC'/);
  assert.doesNotMatch(script,/event\.code==='Backquote'/);
  assert.match(styles,/\.workspace-console\[hidden\]\s*\{\s*display:none !important;/);
});

test('renders Help in one column with a borderless shortcut table', () => {
  assert.match(script,/className='help-shortcut-table'/);
  assert.match(styles,/\.workspace-help\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/);
  assert.match(styles,/\.help-shortcut-table\s*\{[^}]*border:\s*0/);
});
