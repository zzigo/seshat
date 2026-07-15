import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEmergence } from '../src/lib/emergence';

test('finds repeated rising title phrases and keeps source navigation ids', () => {
  const signals = detectEmergence([
    { id:'a', title:'Early studies of sonic epistemology', year:2001 },
    { id:'b', title:'Sonic epistemology and listening practices', year:2016 },
    { id:'c', title:'Sonic epistemology in artistic research', year:2018 },
    { id:'d', title:'Sonic epistemology after computation', year:2021 },
    { id:'e', title:'Unrelated archival methods', year:2020 },
  ]);
  const signal = signals.find((item) => item.phrase === 'sonic epistemology');
  assert.ok(signal);
  assert.equal(signal.firstYear, 2001);
  assert.deepEqual(new Set(signal.itemIds), new Set(['a','b','c','d']));
});

test('does not invent emergence from a phrase used by one item', () => {
  assert.deepEqual(detectEmergence([{ id:'a', title:'Singular unusual phrase', year:2024 }]), []);
});
