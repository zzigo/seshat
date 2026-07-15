import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeThemeMode, themePresetForMode } from '../src/lib/theme-preferences';

test('never carries a dark preset back into light mode', () => {
  assert.equal(themePresetForMode('light', 'ink'), 'papyrus');
  assert.equal(themePresetForMode('light', 'sage'), 'sage');
});

test('never carries a light preset into dark mode', () => {
  assert.equal(themePresetForMode('dark', 'papyrus'), 'ink');
  assert.equal(themePresetForMode('dark', 'navy'), 'navy');
  assert.equal(normalizeThemeMode('unexpected'), 'light');
});
