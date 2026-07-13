import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationCharacterCount, normalizeReaderLanguage, splitReadingSentences } from '../src/scripts/read-aloud';
import { phonemizeSpanish } from '../src/scripts/spanish-phonemizer';
import { billableCharacterCount, chirpMonth, nextChirpRenewal } from '../src/lib/chirp';

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

test('phonemizes Spanish text for Kokoro', async () => {
  assert.match(await phonemizeSpanish('Hola mundo.'), /ˈola/);
});

test('counts Chirp usage by Unicode characters and renews on the next UTC month', () => {
  assert.equal(billableCharacterCount('voz 🎼'), 5);
  assert.equal(chirpMonth(new Date('2026-12-31T23:59:59Z')), '2026-12');
  assert.equal(nextChirpRenewal(new Date('2026-12-31T23:59:59Z')), '2027-01-01T00:00:00.000Z');
  assert.equal(narrationCharacterCount('Primera frase. Segunda frase.', 'es'), 29);
});
