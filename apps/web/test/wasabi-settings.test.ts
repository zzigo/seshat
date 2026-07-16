import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWasabiRoot, safeWasabiRelativePath, validWasabiRoot, wasabiKeyWithinRoot } from '../src/lib/wasabi-settings';

test('normalizes bucket URLs and separators into an object-key root', () => {
  assert.equal(normalizeWasabiRoot('s3://my-bucket/zzttuntref\\libros/'), 'zzttuntref/libros');
});

test('rejects traversal while accepting nested relative folders', () => {
  assert.equal(safeWasabiRelativePath('philosophy/ancient'), 'philosophy/ancient');
  assert.equal(safeWasabiRelativePath('../private'), null);
  assert.equal(validWasabiRoot('zzttuntref/libros'), true);
});

test('only links keys below the configured library root', () => {
  assert.equal(wasabiKeyWithinRoot('zzttuntref/libros/a/book.pdf', 'zzttuntref/libros'), true);
  assert.equal(wasabiKeyWithinRoot('zzttuntref/elsewhere/book.pdf', 'zzttuntref/libros'), false);
  assert.equal(wasabiKeyWithinRoot('zzttuntref/libros/.seshat/private.txt', 'zzttuntref/libros'), false);
});
