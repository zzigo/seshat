export async function phonemizeSpanish(text: string): Promise<string> {
  const { default: createESpeak } = await import('espeak-ng');
  const output = `seshat-es-${crypto.randomUUID()}`;
  const espeak = await createESpeak({
    arguments: ['--phonout', output, '--sep=""', '-q', '-b=1', '--ipa=3', '-v', 'es', text],
  });
  const phonemes = String(espeak.FS.readFile(output, { encoding: 'utf8' }) || '').trim();
  if (!phonemes) throw new Error('Spanish phonemization returned no output.');
  return phonemes;
}
