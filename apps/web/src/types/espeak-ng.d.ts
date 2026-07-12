declare module 'espeak-ng' {
  type ESpeakModule = {
    FS: { readFile(path: string, options: { encoding: 'utf8' }): string };
  };
  export default function createESpeak(options: { arguments: string[] }): Promise<ESpeakModule>;
}
