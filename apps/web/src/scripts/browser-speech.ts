type SpeakOptions = {
  text: string;
  voice: SpeechSynthesisVoice;
  language: string;
  rate: number;
  isCurrent: () => boolean;
  onStart?: () => void;
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
  prepare() { speechSynthesis.cancel(); speechSynthesis.resume(); this.utterance = null; }

  async speak(options: SpeakOptions): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let activeTimer = 0;
      let activeMs = 0;
      const utterance = new SpeechSynthesisUtterance(options.text);
      this.utterance = utterance;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(startTimer);
        window.clearInterval(activeTimer);
        if (this.utterance === utterance) this.utterance = null;
        error ? reject(error) : resolve();
      };
      const startTimer = window.setTimeout(() => {
        if (this.utterance === utterance) speechSynthesis.cancel();
        finish(options.isCurrent() ? new Error(`Voice ${options.voice.name} did not start.`) : undefined);
      }, 20000);
      utterance.voice = options.voice;
      utterance.lang = options.voice.lang || options.language;
      utterance.rate = options.rate;
      utterance.onstart = () => {
        window.clearTimeout(startTimer);
        options.onStart?.();
        const limit = Math.max(30000, options.text.length * 160 / Math.max(options.rate, .5));
        activeTimer = window.setInterval(() => {
          if (!speechSynthesis.paused) activeMs += 2000;
          if (activeMs >= limit) {
            speechSynthesis.cancel();
            finish(new Error(`Voice ${options.voice.name} stopped responding.`));
          }
        }, 2000);
      };
      utterance.onend = () => finish();
      utterance.onerror = (event) => event.error === 'canceled' || event.error === 'interrupted'
        ? finish()
        : finish(new Error(`${options.voice.name} · ${event.error || 'speech synthesis failed'}`));
      if (speechSynthesis.paused) speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    });
  }
}

export const browserSpeech = new BrowserSpeechEngine();
