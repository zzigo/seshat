type SpeakOptions = {
  text: string;
  voice: SpeechSynthesisVoice;
  language: string;
  rate: number;
  isCurrent: () => boolean;
  onStart?: () => void;
  onWord?: (charIndex: number, charLength?: number) => void;
};

export const normalizeBrowserSpeechText = (value:string):string => String(value || '').normalize('NFC')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g,' ')
  .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g,'')
  .replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g,' ')
  .replace(/\[\s*(?:(?:see|cf\.?|e\.g\.?)\s*)?[A-Z][a-zA-Z\s]+(?:et al\.?)?,?\s*(?:18|19|20)\d{2}[^\]]*\]/gu,' ')
  .replace(/\((?:(?:see|cf\.?|e\.g\.?|i\.e\.?)\s*)?[A-Z][a-zA-Z\s]+(?:et al\.?)?,?\s*(?:18|19|20)\d{2}[a-z]?(?::\s*\d+(?:[-–]\d+)?)?\)/gu,' ')
  .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g,' ')
  .replace(/\b(?:p(?:p)?\.?|pages?|p[áa]g(?:ina)?s?\.?)\s*\d+(?:\s*[-–—]\s*\d+)?\b/giu,' ')
  .replace(/\bISBN(?:-1[03])?\s*:?[\s-]*(?:97[89][\s-]*)?[0-9X][0-9X\s-]{7,}[0-9X]\b/giu,' ')
  .replace(/\b[0-9X](?:[0-9X\s-]*[0-9X])\b/giu,(token)=>token.replace(/[^0-9]/g,'').length>=7?' ':token)
  .replace(/[«»“”„‟]/g,'"')
  .replace(/[‘’‚‛]/g,"'")
  .replace(/["']{2,}/g,'"')
  .replace(/(?:^|\s)["']\s*(?=\S)/g,' ')
  .replace(/(?<=\S)\s*["'](?:\s|$)/g,' ')
  .replace(/[-–—]{2,}/g,' — ')
  .replace(/\.{3,}/g,'…')
  .replace(/\s+/g,' ').trim();

export const browserSpeechChunks = (value:string,maximum=260):string[] => {
  const text=normalizeBrowserSpeechText(value),limit=Math.max(80,Math.floor(maximum));if(!text)return[];
  const chunks:string[]=[];let rest=text;
  while(rest.length>limit){const window=rest.slice(0,limit+1),minimum=Math.floor(limit*.55);let split=-1;for(const pattern of [/[.!?;:]\s/g,/[,—–-]\s/g,/\s/g]){for(const match of window.matchAll(pattern)){const end=(match.index||0)+match[0].length;if(end>=minimum&&end<=limit)split=end;}if(split>=minimum)break;}if(split<minimum)split=limit;chunks.push(rest.slice(0,split).trim());rest=rest.slice(split).trim();}
  if(rest)chunks.push(rest);return chunks;
};

class BrowserSpeechEngine {
  private utterance: SpeechSynthesisUtterance | null = null;

  async voices(): Promise<SpeechSynthesisVoice[]> {
    let voices = speechSynthesis.getVoices();
    if (voices.length) return voices;
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 1200);
      speechSynthesis.addEventListener('voiceschanged', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
    return speechSynthesis.getVoices();
  }

  pause() { speechSynthesis.pause(); }
  resume() { speechSynthesis.resume(); }
  stop() { speechSynthesis.cancel(); this.utterance = null; }

  async speak(options: SpeakOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let activeTimer = 0;
      let fallbackWordTimer = 0;
      let activeMs = 0;
      let gotBoundary = false;
      const text=normalizeBrowserSpeechText(options.text);if(!text){resolve();return;}
      const utterance = new SpeechSynthesisUtterance(text);
      this.utterance = utterance;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        window.clearInterval(activeTimer);
        window.clearInterval(fallbackWordTimer);
        if (this.utterance === utterance) this.utterance = null;
        error ? reject(error) : resolve();
      };

      const startTimer = window.setTimeout(() => {
        console.warn('[seshat:browser-speech] voice did not start', { voice: options.voice.name, language: utterance.lang,characters:text.length,pending: speechSynthesis.pending, speaking: speechSynthesis.speaking, paused: speechSynthesis.paused });
        if (this.utterance === utterance) speechSynthesis.cancel();
        finish(options.isCurrent() ? new Error(`Voice ${options.voice.name} did not start · pending ${speechSynthesis.pending} · paused ${speechSynthesis.paused}.`) : undefined);
      }, 10000);

      utterance.voice = options.voice;
      utterance.lang = options.voice.lang || options.language;
      utterance.rate = options.rate;

      // Real word boundaries from Web Speech API
      utterance.onboundary = (event) => {
        if (event.name === 'word') {
          gotBoundary = true;
          options.onWord?.(event.charIndex, event.charLength || 1);
        }
      };

      utterance.onstart = () => {
        window.clearTimeout(startTimer);
        options.onStart?.();

        // Fallback word progression if engine does not emit boundary events
        const words: Array<{ index: number; length: number }> = [];
        const regex = /\S+/gu;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
          words.push({ index: match.index, length: match[0].length });
        }
        if (words.length > 0 && options.onWord) {
          options.onWord(words[0].index, words[0].length);
          let wordIdx = 1;
          const avgWordInterval = Math.max(90, Math.min(600, (text.length * 55) / (words.length * Math.max(options.rate, 0.5))));
          fallbackWordTimer = window.setInterval(() => {
            if (gotBoundary || speechSynthesis.paused) return;
            if (wordIdx < words.length) {
              options.onWord?.(words[wordIdx].index, words[wordIdx].length);
              wordIdx += 1;
            } else {
              window.clearInterval(fallbackWordTimer);
            }
          }, avgWordInterval);
        }

        const limit = Math.max(30000, text.length * 160 / Math.max(options.rate, .5));
        activeTimer = window.setInterval(() => {
          if (!speechSynthesis.paused) activeMs += 2000;
          if (activeMs >= limit) {
            speechSynthesis.cancel();
            finish(new Error(`Voice ${options.voice.name} stopped responding.`));
          }
        }, 2000);
      };

      utterance.onend = () => finish();
      utterance.onerror = (event) => {
        console.warn('[seshat:browser-speech] utterance error', { voice:options.voice.name,error:event.error,characters:text.length });
        // Don't crash reading session on interruptions, cancel or non-fatal speech syntax errors
        if (event.error === 'canceled' || event.error === 'interrupted' || event.error === 'text-too-long') {
          finish();
        } else {
          finish(new Error(`${options.voice.name} · ${event.error || 'speech synthesis failed'}`));
        }
      };

      if(speechSynthesis.paused)speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    });
  }
}

export const browserSpeech = new BrowserSpeechEngine();
