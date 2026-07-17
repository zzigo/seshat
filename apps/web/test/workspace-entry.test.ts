import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWorkspacePreference, resolveWorkspaceDestination } from '../src/lib/workspace-entry';

test('normalizes only explicit workspace preferences', () => {
  assert.equal(normalizeWorkspacePreference('mobile'), 'mobile');
  assert.equal(normalizeWorkspacePreference('desktop'), 'desktop');
  assert.equal(normalizeWorkspacePreference('auto'), null);
});

test('routes only compact coarse-pointer devices to Mobwork automatically', () => {
  assert.equal(resolveWorkspaceDestination({ preference: null, coarsePointer: true, viewportWidth: 900 }), '/mobwork');
  assert.equal(resolveWorkspaceDestination({ preference: null, coarsePointer: true, viewportWidth: 901 }), '/workspace');
  assert.equal(resolveWorkspaceDestination({ preference: null, coarsePointer: false, viewportWidth: 390 }), '/workspace');
});

test('a saved manual preference overrides device detection', () => {
  assert.equal(resolveWorkspaceDestination({ preference: 'desktop', coarsePointer: true, viewportWidth: 390 }), '/workspace');
  assert.equal(resolveWorkspaceDestination({ preference: 'mobile', coarsePointer: false, viewportWidth: 1400 }), '/mobwork');
});
