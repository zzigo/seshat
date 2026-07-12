import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReaderLanguage, splitReadingSentences } from '../src/scripts/read-aloud';

test('segments reading text while preserving annotation offsets', () => {
  const source = '# Uno\n\nPrimera frase. Segunda frase con [enlace](https://example.test).';
  const sentences = splitReadingSentences(source, 'es');
  assert.equal(sentences.at(-2)?.text, 'Primera frase.');
  assert.equal(sentences.at(-1)?.text, 'Segunda frase con enlace.');
  assert.equal(source.slice(sentences.at(-1)!.start, sentences.at(-1)!.end).trim(), 'Segunda frase con [enlace](https://example.test).');
});

test('normalizes catalog and BCP-47 language values for voice selection', () => {
  assert.equal(normalizeReaderLanguage('spa'), 'es');
  assert.equal(normalizeReaderLanguage('Spanish'), 'es');
  assert.equal(normalizeReaderLanguage('es-ES'), 'es');
  assert.equal(normalizeReaderLanguage('eng'), 'en');
  assert.equal(normalizeReaderLanguage('en_GB'), 'en');
});
