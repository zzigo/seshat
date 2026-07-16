import assert from 'node:assert/strict';
import test from 'node:test';
import { nextZoteroBeaconIdleState } from '../src/lib/zotero-beacon';

test('auto-disables the Zotero beacon after three successful unchanged checks', () => {
  assert.deepEqual(nextZoteroBeaconIdleState(0, false), { idleChecks:1, autoDisable:false });
  assert.deepEqual(nextZoteroBeaconIdleState(1, false), { idleChecks:2, autoDisable:false });
  assert.deepEqual(nextZoteroBeaconIdleState(2, false), { idleChecks:3, autoDisable:true });
});

test('real synchronization work resets the Zotero beacon idle streak', () => {
  assert.deepEqual(nextZoteroBeaconIdleState(2, true), { idleChecks:0, autoDisable:false });
});
