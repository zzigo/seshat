import assert from 'node:assert/strict';
import test from 'node:test';
import { splitReadingSentences } from '../src/scripts/read-aloud';

test('segments reading text while preserving annotation offsets', () => {
  const source = '# Uno\n\nPrimera frase. Segunda frase con [enlace](https://example.test).';
  const sentences = splitReadingSentences(source, 'es');
  assert.equal(sentences.at(-2)?.text, 'Primera frase.');
  assert.equal(sentences.at(-1)?.text, 'Segunda frase con enlace.');
  assert.equal(source.slice(sentences.at(-1)!.start, sentences.at(-1)!.end).trim(), 'Segunda frase con [enlace](https://example.test).');
});
