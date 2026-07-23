import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../src/scripts/workspace.ts',import.meta.url),'utf8');
const styles = readFileSync(new URL('../src/styles/workspace.css',import.meta.url),'utf8');

test('toggles the active keyword filter and exposes its selected state',()=>{
  assert.match(script,/activeKeyword = activeKeyword === keyword \? null : keyword/);
  assert.match(script,/setAttribute\('aria-pressed',String\(activeKeyword===keyword\)\)/);
  assert.match(styles,/\.keyword-chip\.active\s*\{[^}]*border-color:/);
  assert.match(styles,/\.keyword-chip\s*\{[^}]*border-radius:\s*999px/);
});

test('keeps the complete Keywords cloud vertically scrollable',()=>{
  assert.match(styles,/\.keyword-pod\[open\]\s*\{[^}]*overflow:\s*hidden/);
  assert.match(styles,/\.keyword-cloud\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(styles,/\.keyword-cloud\s*\{[^}]*touch-action:\s*pan-y/);
});
