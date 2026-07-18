'use strict';

/* Procedural WebAudio: wind, dragonfire, roars. No audio files needed. */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  /* must be called from a user gesture */
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(ctx.destination);

    // shared 2s white-noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // wind loop
    this.windSrc = this.loopNoise();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = this.gain(0);
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);

    // fire loop
    this.fireSrc = this.loopNoise();
    this.fireFilter = ctx.createBiquadFilter();
    this.fireFilter.type = 'lowpass';
    this.fireFilter.frequency.value = 300;
    this.fireGain = this.gain(0);
    this.fireSrc.connect(this.fireFilter).connect(this.fireGain).connect(this.master);
  }

  gain(v) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.start();
    return s;
  }

  setWind(v) {   // v: 0..1 by airspeed
    if (!this.ctx) return;
    this.windGain.gain.setTargetAtTime(0.03 + v * 0.4, this.ctx.currentTime, 0.15);
    this.windFilter.frequency.setTargetAtTime(350 + v * 900, this.ctx.currentTime, 0.2);
  }

  setFire(on) {
    if (!this.ctx) return;
    this.fireGain.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.05 : 0.2);
    this.fireFilter.frequency.setTargetAtTime(on ? 850 : 300, this.ctx.currentTime, 0.1);
  }

  distortionCurve(k = 24) {
    const n = 256, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  roar() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(85, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.9);

    const shaper = ctx.createWaveShaper();
    shaper.curve = this.distortionCurve();

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);

    osc.connect(shaper).connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 1.2);

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 1);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.35, t + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
    noise.connect(f).connect(g2).connect(this.master);
    noise.start(t);
    noise.stop(t + 1.1);
  }

  ignite() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1400, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    noise.connect(f).connect(g).connect(this.master);
    noise.start(t);
    noise.stop(t + 0.6);
  }

  toggleMute() {
    if (!this.ctx) return true;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.05);
    return this.muted;
  }
}
