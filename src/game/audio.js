// Small procedural sound engine (WebAudio). No asset files required.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.55;
    this.ready = false;
  }

  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
    this.ready = true;
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.enabled ? v : 0;
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.15, attack = 0.005, sweep = null, delay = 0 }) {
    if (!this.ready || !this.enabled) return;
    const t = this.now() + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweep !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise({ dur = 0.3, gain = 0.2, filterFreq = 900, q = 0.9, sweepTo = null, delay = 0 }) {
    if (!this.ready || !this.enabled) return;
    const t = this.now() + delay;
    const frames = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  click() {
    this.tone({ freq: 620, type: 'triangle', dur: 0.055, gain: 0.05, sweep: 520 });
  }

  select() {
    this.tone({ freq: 420, type: 'sine', dur: 0.09, gain: 0.06, sweep: 560 });
  }

  build() {
    this.tone({ freq: 330, type: 'triangle', dur: 0.1, gain: 0.08 });
    this.tone({ freq: 494, type: 'triangle', dur: 0.16, gain: 0.07, delay: 0.07 });
  }

  recruit() {
    this.tone({ freq: 220, type: 'sine', dur: 0.1, gain: 0.08 });
    this.tone({ freq: 330, type: 'sine', dur: 0.12, gain: 0.06, delay: 0.05 });
  }

  war() {
    this.tone({ freq: 110, type: 'sawtooth', dur: 0.7, gain: 0.1, sweep: 70 });
    this.noise({ dur: 0.5, gain: 0.09, filterFreq: 260, q: 0.7 });
  }

  victory() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, type: 'triangle', dur: 0.25, gain: 0.08, delay: i * 0.085 })
    );
  }

  defeat() {
    [392, 330, 262, 196].forEach((f, i) =>
      this.tone({ freq: f, type: 'sine', dur: 0.32, gain: 0.09, delay: i * 0.11 })
    );
  }

  battle() {
    this.noise({ dur: 0.42, gain: 0.16, filterFreq: 700, q: 0.6, sweepTo: 200 });
    this.tone({ freq: 90, type: 'sine', dur: 0.3, gain: 0.12, sweep: 50 });
  }

  cannon() {
    this.noise({ dur: 0.28, gain: 0.18, filterFreq: 420, q: 0.5, sweepTo: 120 });
  }

  naval() {
    this.noise({ dur: 0.6, gain: 0.08, filterFreq: 500, q: 1.2, sweepTo: 1200 });
    this.tone({ freq: 180, type: 'sine', dur: 0.5, gain: 0.05, sweep: 240 });
  }

  nuke() {
    this.noise({ dur: 1.6, gain: 0.24, filterFreq: 1800, q: 0.4, sweepTo: 90 });
    this.tone({ freq: 70, type: 'sine', dur: 1.4, gain: 0.2, sweep: 28 });
  }

  cash() {
    this.tone({ freq: 880, type: 'triangle', dur: 0.08, gain: 0.05 });
    this.tone({ freq: 1180, type: 'triangle', dur: 0.1, gain: 0.04, delay: 0.05 });
  }

  alert() {
    this.tone({ freq: 740, type: 'square', dur: 0.09, gain: 0.045 });
    this.tone({ freq: 740, type: 'square', dur: 0.09, gain: 0.045, delay: 0.14 });
  }
}
