// Voz narradora con la síntesis de voz del sistema (SpeechSynthesis): sin red y sin coste.
// Lee injects, alertas y el inicio de cada ronda. Si el navegador no tiene voz en español, queda en silencio.

const KEY = 'simulacro:voz';

export const voice = {
  supported: typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
  enabled: true,
  _voice: null,

  init() {
    try { this.enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* sin almacenamiento */ }
    if (!this.supported) return;
    const pick = () => {
      const voices = speechSynthesis.getVoices();
      this._voice = voices.find((v) => /^es[-_]ES/i.test(v.lang)) || voices.find((v) => /^es/i.test(v.lang)) || null;
    };
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
  },

  setEnabled(on) {
    this.enabled = on;
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
    if (!on) this.stop();
  },

  // Interrumpe lo que se esté leyendo y lee el texto nuevo.
  say(text, { rate = 1.02, pitch = 1 } = {}) {
    if (!this.supported || !this.enabled || !text) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(String(text).replace(/[«»]/g, ''));
    u.lang = this._voice ? this._voice.lang : 'es-ES';
    if (this._voice) u.voice = this._voice;
    u.rate = rate;
    u.pitch = pitch;
    speechSynthesis.speak(u);
  },

  stop() {
    if (this.supported) speechSynthesis.cancel();
  },
};
