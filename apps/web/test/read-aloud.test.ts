import assert from 'node:assert/strict';
import test from 'node:test';
import { narrationCharacterCount, normalizeReaderLanguage, splitReadingSentences, steppedReaderRate } from '../src/scripts/read-aloud';
import { phonemizeSpanish } from '../src/scripts/spanish-phonemizer';
import { billableCharacterCount, chirpMonth, nextChirpRenewal } from '../src/lib/chirp';
import { chirpAccessAllowed } from '../src/lib/chirp-access';
import { browserSpeechChunks, normalizeBrowserSpeechText } from '../src/scripts/browser-speech';

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

test('steps reader speed by quarters within safe playback bounds', () => {
  assert.equal(steppedReaderRate(1,.25),1.25);
  assert.equal(steppedReaderRate(.5,-.25),.5);
  assert.equal(steppedReaderRate(2,.25),2);
});

test('restricts Chirp to the configured server allowlist', () => {
  const previous=process.env.GOOGLE_TTS_ALLOWED_EMAILS;process.env.GOOGLE_TTS_ALLOWED_EMAILS='reader@example.test, ADMIN@MUSIKI.ORG.AR';
  try{assert.equal(chirpAccessAllowed('reader@example.test'),true);assert.equal(chirpAccessAllowed('admin@musiki.org.ar'),true);assert.equal(chirpAccessAllowed('other@example.test'),false);}
  finally{if(previous===undefined)delete process.env.GOOGLE_TTS_ALLOWED_EMAILS;else process.env.GOOGLE_TTS_ALLOWED_EMAILS=previous;}
});

test('sanitizes invisible document controls before browser speech', () => {
  assert.equal(normalizeBrowserSpeechText('Texto\u0000 con\u00ad controles\u202E.'),'Texto con controles.');
});

test('omits page references, ISBNs, and long identifiers but preserves years', () => {
  assert.equal(normalizeBrowserSpeechText('Publicado en 2024, página 123. ISBN 978-3-16-148410-0. Código 123456789.'),'Publicado en 2024, . . Código .');
});

test('removes repeated running headers and isolated folios from reading text', () => {
  const source='REVISTA MUSICAL\n1\nPrimera frase.\nREVISTA MUSICAL\n2\nSegunda frase.\nREVISTA MUSICAL\n3\nTercera frase.';
  const text=splitReadingSentences(source,'es').map((sentence)=>sentence.text).join(' ');
  assert.doesNotMatch(text,/REVISTA MUSICAL|(?:^|\s)[123](?:\s|$)/);assert.match(text,/Primera frase/);assert.match(text,/Tercera frase/);
});

test('breaks long document sentences into Microsoft-safe utterances', () => {
  const chunks=browserSpeechChunks(`${'palabra '.repeat(70)}Final.`,260);
  assert.ok(chunks.length>1);assert.ok(chunks.every((chunk)=>chunk.length<=260));assert.equal(chunks.join(' ').split(/\s+/).length,71);
});
