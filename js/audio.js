// audio.js — целият звук е синтезиран. Дроновете бръмчат позиционно,
// така че се чуват отляво/отдясно и се проследяват по слух, преди да влязат
// в кадър. Това е половината геймплей на тъмно.

import * as THREE from 'three';

export class Sound {
  constructor(camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.enabled = true;
  }

  async resume() {
    if (this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (_) { /* нищо */ }
    }
  }

  setEnabled(v) {
    this.enabled = v;
    this.listener.setMasterVolume(v ? 1 : 0);
  }

  // Постоянно бръмчене, закачено за обект в сцената
  attachHum(object3d, freq = 96) {
    if (!this.enabled) return null;
    const audio = new THREE.PositionalAudio(this.listener);
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    lfo.frequency.value = 5.5;
    lfoGain.gain.value = 8;
    lfo.connect(lfoGain).connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 620;

    osc.connect(filter);
    osc.start();
    lfo.start();

    audio.setNodeSource(filter);
    audio.setRefDistance(0.8);
    audio.setRolloffFactor(1.6);
    audio.setVolume(0.35);
    object3d.add(audio);

    return () => {
      try { osc.stop(); lfo.stop(); } catch (_) { /* нищо */ }
      object3d.remove(audio);
    };
  }

  // Кратък звук без позиция
  blip({ freq = 880, dur = 0.09, type = 'square', gain = 0.18, slide = 0 } = {}) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.listener.getInput());
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  kill() { this.blip({ freq: 1320, slide: -700, dur: 0.12, type: 'square' }); }
  wound() { this.blip({ freq: 620, dur: 0.06, type: 'triangle', gain: 0.12 }); }
  miss() { this.blip({ freq: 180, dur: 0.05, type: 'sine', gain: 0.08 }); }
  mimic() { this.blip({ freq: 220, slide: -120, dur: 0.28, type: 'sawtooth', gain: 0.22 }); }
  bonus() {
    this.blip({ freq: 880, dur: 0.08 });
    setTimeout(() => this.blip({ freq: 1320, dur: 0.14 }), 80);
  }
  sting() { this.blip({ freq: 140, slide: -60, dur: 0.3, type: 'sawtooth', gain: 0.3 }); }
  overheat() { this.blip({ freq: 90, dur: 0.4, type: 'sawtooth', gain: 0.2 }); }
  wave() {
    this.blip({ freq: 520, dur: 0.1 });
    setTimeout(() => this.blip({ freq: 780, dur: 0.18 }), 110);
  }
}

// Вибрация през XR геймпада, ако телефонът я дава
export function haptic(inputSource, intensity = 0.6, ms = 40) {
  const act = inputSource?.gamepad?.hapticActuators?.[0];
  if (act?.pulse) {
    try { act.pulse(intensity, ms); return; } catch (_) { /* нищо */ }
  }
  if (navigator.vibrate) navigator.vibrate(ms);
}
