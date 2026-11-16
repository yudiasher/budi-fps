// audio.js — all sound is synthesised with WebAudio; the game ships no
// audio files. One AudioContext, lazily created on the first user gesture
// (browsers require that), and short procedural blips for each event.
export class AudioBank {
  constructor() {
    this.ctx = null;
    this.master = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  // A short burst of filtered noise (gunshot body) plus a click.
  shot(kind, dist = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const vol = Math.max(0.05, 1 - dist / 70);
    const dur = kind === 'dmr' ? 0.22 : kind === 'pistol' ? 0.09 : 0.12;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = kind === 'dmr' ? 900 : 2200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.9 * vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    // Low thump.
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(kind === 'dmr' ? 120 : 180, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.5 * vol, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og); og.connect(this.master);
    o.start(t); o.stop(t + 0.15);
  }
  tone(freq, dur, type = 'sine', vol = 0.3, slideTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  hit() { this.tone(1400, 0.07, 'square', 0.18); }
  headshot() { this.tone(1800, 0.09, 'square', 0.22); this.tone(2400, 0.07, 'square', 0.15); }
  dry() { this.tone(300, 0.05, 'square', 0.15); }
  reload() { this.tone(500, 0.05, 'square', 0.12); setTimeout(() => this.tone(700, 0.05, 'square', 0.12), 250); }
  hurt() { this.tone(160, 0.18, 'sawtooth', 0.25, 90); }
  explosion() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.7);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.0, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    this.tone(70, 0.5, 'sine', 0.5, 30);
  }
  beep() { this.tone(880, 0.12, 'sine', 0.25); }
  plant() { this.tone(660, 0.1, 'sine', 0.2); setTimeout(() => this.tone(990, 0.14, 'sine', 0.2), 140); }
  win() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'triangle', 0.25), i * 160)); }
  lose() { [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'triangle', 0.25), i * 180)); }
}
