// Generative ambient music engine for AllMansSky — all WebAudio, all synthesized.
// Used internally by the audio singleton (audio.setScene). Layered detuned
// triangle/sine pad voices run through a slow lowpass, a feedback delay and a
// multi-tap fake reverb; chords come from a seeded random walk over
// pentatonic/modal scales and change every 8–16 s; sparse bell motifs shimmer
// on top. Scene moods: menu = ethereal slow, space = vast cold minor + sub
// drone, surface biomes get their own flavor. Crossfades 3 s between scenes;
// a `danger` parameter raises a tense low pulse. CPU budget: < 12 sustained
// voices at any time.
import { RNG, hashString } from '../core/rng.js';

/** Scale interval tables (semitones from root). */
const SCALES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/**
 * Mood presets. pad = per-layer pad loudness, change = [min,max] seconds
 * between chords, filter = lowpass base Hz, sub = sub-drone gain,
 * bellChance/bellLevel/bellOct = sparse motif params, pulse = built-in tension.
 */
const MOODS = {
  menu: { scale: 'lydian', root: 220.0, change: [12, 17], pad: 0.4, waves: ['triangle', 'sine'], detune: 6, filter: 1150, filterLfo: 320, sub: 0.12, bellChance: 0.5, bellLevel: 0.13, bellOct: 2, add9: true, pulse: 0 },
  space: { scale: 'minorPent', root: 146.83, change: [10, 16], pad: 0.34, waves: ['sine', 'triangle'], detune: 5, filter: 760, filterLfo: 220, sub: 0.28, bellChance: 0.3, bellLevel: 0.09, bellOct: 2, add9: false, pulse: 0 },
  surface: { scale: 'dorian', root: 174.61, change: [9, 14], pad: 0.38, waves: ['triangle', 'sine'], detune: 7, filter: 1000, filterLfo: 280, sub: 0.13, bellChance: 0.45, bellLevel: 0.12, bellOct: 1, add9: false, pulse: 0 },
  lush: { scale: 'majorPent', root: 196.0, change: [8, 13], pad: 0.4, waves: ['triangle', 'triangle'], detune: 8, filter: 1350, filterLfo: 360, sub: 0.1, bellChance: 0.6, bellLevel: 0.16, bellOct: 1, add9: true, pulse: 0 },
  frozen: { scale: 'majorPent', root: 311.13, change: [9, 15], pad: 0.3, waves: ['sine', 'sine'], detune: 4, filter: 2100, filterLfo: 520, sub: 0.06, bellChance: 0.75, bellLevel: 0.2, bellOct: 2, add9: true, pulse: 0 },
  volcanic: { scale: 'phrygian', root: 110.0, change: [8, 12], pad: 0.36, waves: ['sawtooth', 'triangle'], detune: 9, filter: 540, filterLfo: 150, sub: 0.22, bellChance: 0.2, bellLevel: 0.07, bellOct: 1, add9: false, pulse: 0.55 },
};

/** Which biomes borrow which mood preset. */
const BIOME_TO_MOOD = {
  lush: 'lush', swamp: 'lush', ocean: 'lush',
  frozen: 'frozen', crystal: 'frozen',
  volcanic: 'volcanic', toxic: 'volcanic', irradiated: 'volcanic',
  desert: 'surface', barren: 'surface',
  exotic: 'menu',
};

/** Frequency for scale index (idx may exceed scale length → octave wrap). */
function degreeFreq(root, scale, idx) {
  const n = scale.length;
  const wrapped = ((idx % n) + n) % n;
  const oct = Math.floor(idx / n);
  return root * Math.pow(2, oct + scale[wrapped] / 12);
}

/** One active mood: pads + sub drone + danger pulse + motif scheduler. */
class SceneLayer {
  constructor(ctx, dest, cfg, key, biome) {
    this.ctx = ctx;
    this.cfg = cfg;
    this.rng = new RNG(hashString('ams-music:' + key + ':' + (biome || '')));
    const t = ctx.currentTime;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);

    // slow-breathing lowpass all pads run through
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = cfg.filter;
    this.filter.Q.value = 0.7;
    this.filter.connect(this.out);

    this.filterLfo = ctx.createOscillator();
    this.filterLfo.frequency.value = 0.03 + this.rng.next() * 0.03;
    this._lfoG = ctx.createGain();
    this._lfoG.gain.value = cfg.filterLfo;
    this.filterLfo.connect(this._lfoG);
    this._lfoG.connect(this.filter.frequency);
    this.filterLfo.start(t);

    this.padBus = ctx.createGain();
    this.padBus.gain.value = 1;
    this.padBus.connect(this.filter);

    // very slow amplitude shimmer on the pads (breathing)
    this.shimLfo = ctx.createOscillator();
    this.shimLfo.frequency.value = 0.05 + this.rng.next() * 0.03;
    this._shimG = ctx.createGain();
    this._shimG.gain.value = 0.07;
    this.shimLfo.connect(this._shimG);
    this._shimG.connect(this.padBus.gain);
    this.shimLfo.start(t);

    // sub drone (glides to each chord root)
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = this._subFreq(cfg.root);
    this._subG = ctx.createGain();
    this._subG.gain.value = cfg.sub;
    this.sub.connect(this._subG);
    this._subG.connect(this.out);
    this.sub.start(t);

    // tense low pulse, gain driven by danger (and cfg.pulse baseline)
    this.pulseOsc = ctx.createOscillator();
    this.pulseOsc.type = 'square';
    this.pulseOsc.frequency.value = Math.min(80, this._subFreq(cfg.root) * 2);
    this._pulseLP = ctx.createBiquadFilter();
    this._pulseLP.type = 'lowpass';
    this._pulseLP.frequency.value = 150;
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.pulseOsc.connect(this._pulseLP);
    this._pulseLP.connect(this.pulseGain);
    this.pulseGain.connect(this.out);
    this.pulseLfo = ctx.createOscillator();
    this.pulseLfo.frequency.value = 1.8 + this.rng.next() * 0.5;
    this.pulseDepth = ctx.createGain();
    this.pulseDepth.gain.value = 0;
    this.pulseLfo.connect(this.pulseDepth);
    this.pulseDepth.connect(this.pulseGain.gain);
    this.pulseOsc.start(t);
    this.pulseLfo.start(t);

    this._voices = [];   // current chord pad voices
    this._live = 0;      // sustained oscillator count (voice budget guard)
    this._dead = false;
    this._deg = this.rng.int(0, SCALES[cfg.scale].length - 1);
    this._nextT = t + 0.2;
    this._timer = setInterval(() => this._tick(), 300);
    this._tick();
  }

  _subFreq(f) {
    while (f > 82) f /= 2;
    return f;
  }

  _tick() {
    if (this._dead) return;
    const ahead = this.ctx.currentTime + 2.5;
    let guard = 0;
    while (this._nextT < ahead && guard++ < 3) {
      this._scheduleChord(this._nextT);
      this._nextT += this.rng.range(this.cfg.change[0], this.cfg.change[1]);
    }
  }

  _scheduleChord(t) {
    const cfg = this.cfg;
    const scale = SCALES[cfg.scale];
    // random walk over degrees, folded into a two-octave span
    this._deg += this.rng.pick([-2, -1, -1, 1, 1, 2]);
    if (this._deg < 0) this._deg += scale.length;
    if (this._deg >= scale.length * 2) this._deg -= scale.length;

    const idxs = cfg.add9 ? [0, 2, 4, scale.length + 1] : [0, 2, 4];

    // release the previous chord with a slow overlap
    for (const v of this._voices) this._releaseVoice(v, t + 1.2);
    this._voices = [];

    const rootF = degreeFreq(cfg.root, scale, this._deg);
    for (const off of idxs) {
      let f = degreeFreq(cfg.root, scale, this._deg + off);
      while (f > cfg.root * 3.1) f /= 2; // keep the register compact
      while (f < cfg.root * 0.7) f *= 2;
      this._spawnPad(f, t);
    }

    this.sub.frequency.setTargetAtTime(this._subFreq(rootF), t, 2.5);
    this.pulseOsc.frequency.setTargetAtTime(Math.min(80, this._subFreq(rootF) * 2), t, 2.5);

    // sparse bell/pluck motif somewhere inside this chord's window
    if (this.rng.chance(cfg.bellChance)) {
      const count = this.rng.int(3, 5);
      let bt = t + this.rng.range(1.5, 4.5);
      const step = this.rng.range(0.16, 0.36);
      for (let i = 0; i < count; i++) {
        const off = this.rng.pick(idxs) + (this.rng.chance(0.3) ? scale.length : 0);
        const f = degreeFreq(cfg.root, scale, this._deg + off) * Math.pow(2, cfg.bellOct);
        this._bell(f, bt, cfg.bellLevel * this.rng.range(0.7, 1));
        bt += step * (i + 1 === count ? this.rng.range(1.6, 2.4) : 1);
      }
    }
  }

  _spawnPad(freq, t) {
    const cfg = this.cfg;
    const oscCount = this._live > 10 ? 1 : 2; // stay under the voice budget
    const level = cfg.pad * 0.35 * (oscCount === 2 ? 0.62 : 1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 3.2);
    g.connect(this.padBus);
    const voice = { g, oscs: [] };
    for (let k = 0; k < oscCount; k++) {
      const o = this.ctx.createOscillator();
      o.type = cfg.waves[k % cfg.waves.length];
      o.frequency.value = freq;
      o.detune.value = (k === 0 ? -1 : 1) * cfg.detune * this.rng.range(0.6, 1.3);
      o.connect(g);
      o.start(t);
      this._live++;
      o.onended = () => { this._live--; };
      voice.oscs.push(o);
    }
    this._voices.push(voice);
  }

  _releaseVoice(v, t) {
    v.g.gain.setTargetAtTime(0, t, 2.0);
    for (const o of v.oscs) { try { o.stop(t + 9); } catch (_) { /* already stopped */ } }
  }

  _bell(freq, t, vol) {
    if (this._live > 13) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.012);
    g.gain.setTargetAtTime(0, t + 0.03, 0.6);
    g.connect(this.padBus);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g);
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.3;
    g2.connect(g);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.02;
    o2.connect(g2);
    this._live += 2;
    o.onended = () => { this._live--; };
    o2.onended = () => { this._live--; };
    o.start(t); o.stop(t + 5);
    o2.start(t); o2.stop(t + 5);
  }

  /** Fade this layer in over fadeSec seconds. */
  start(fadeSec) {
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(1, t + fadeSec);
  }

  /** 0..1 — raises the low tension pulse. */
  setDanger(d) {
    const base = Math.min(1, Math.max(0, d)) * 0.2 + (this.cfg.pulse || 0) * 0.07;
    const t = this.ctx.currentTime;
    this.pulseGain.gain.setTargetAtTime(base, t, 0.8);
    this.pulseDepth.gain.setTargetAtTime(base * 0.85, t, 0.8);
  }

  /** Fade out over fadeSec then tear all nodes down. */
  stop(fadeSec) {
    if (this._dead) return;
    this._dead = true;
    clearInterval(this._timer);
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.linearRampToValueAtTime(0, t + fadeSec);
    setTimeout(() => this._kill(), (fadeSec + 1.5) * 1000);
  }

  _kill() {
    const stop = (o) => { try { o.stop(); } catch (_) { /* ok */ } };
    for (const v of this._voices) for (const o of v.oscs) stop(o);
    [this.sub, this.pulseOsc, this.pulseLfo, this.filterLfo, this.shimLfo].forEach(stop);
    try { this.out.disconnect(); } catch (_) { /* ok */ }
  }
}

/**
 * Generative ambient music engine. Owns a shared FX chain (slow lowpass per
 * layer → feedback delay + multi-tap fake reverb) and one active SceneLayer,
 * crossfading 3 s when the scene mood changes.
 *
 * Constructed internally by the audio singleton — not a public game module.
 */
export class MusicEngine {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination music bus to feed
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.input.gain.value = 1;

    this._dry = ctx.createGain();
    this._dry.gain.value = 0.8;
    this.input.connect(this._dry);
    this._dry.connect(destination);

    // long feedback delay (darkened repeats)
    this._delay = ctx.createDelay(2);
    this._delay.delayTime.value = 0.46;
    const fbLP = ctx.createBiquadFilter();
    fbLP.type = 'lowpass';
    fbLP.frequency.value = 1900;
    this._fb = ctx.createGain();
    this._fb.gain.value = 0.42;
    this.input.connect(this._delay);
    this._delay.connect(fbLP);
    fbLP.connect(this._fb);
    this._fb.connect(this._delay);
    this._dlWet = ctx.createGain();
    this._dlWet.gain.value = 0.3;
    this._delay.connect(this._dlWet);
    this._dlWet.connect(destination);

    // multi-tap fake reverb, taps panned alternately for width
    const revLP = ctx.createBiquadFilter();
    revLP.type = 'lowpass';
    revLP.frequency.value = 2400;
    this._revWet = ctx.createGain();
    this._revWet.gain.value = 0.5;
    revLP.connect(this._revWet);
    this._revWet.connect(destination);
    const taps = [[0.089, 0.5], [0.157, 0.38], [0.251, 0.28], [0.389, 0.2], [0.577, 0.13]];
    taps.forEach(([time, gain], i) => {
      const d = ctx.createDelay(1);
      d.delayTime.value = time;
      const tg = ctx.createGain();
      tg.gain.value = gain;
      this.input.connect(d);
      d.connect(tg);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = (i % 2 === 0 ? 1 : -1) * (0.25 + 0.1 * i);
        tg.connect(p);
        p.connect(revLP);
      } else {
        tg.connect(revLP);
      }
    });

    this._layer = null;
    this._key = null;
  }

  /**
   * Switch mood. Same mood → only the danger level updates; a new mood
   * crossfades in over 3 s.
   * @param {'menu'|'space'|'surface'} kind
   * @param {{biome?: string, danger?: number}} [mood]
   */
  setScene(kind, mood = {}) {
    const key = kind === 'surface'
      ? (BIOME_TO_MOOD[mood.biome] || 'surface')
      : (MOODS[kind] ? kind : 'menu');
    const danger = Math.min(1, Math.max(0, mood.danger || 0));
    if (this._layer && this._key === key && !this._layer._dead) {
      this._layer.setDanger(danger);
      return;
    }
    const old = this._layer;
    this._key = key;
    this._layer = new SceneLayer(this.ctx, this.input, MOODS[key], key, mood.biome);
    this._layer.start(3);
    this._layer.setDanger(danger);
    if (old) old.stop(3);
  }

  /** Update tension on the current layer without changing mood. */
  setDanger(d) {
    if (this._layer && !this._layer._dead) this._layer.setDanger(d);
  }

  /** Stop everything and disconnect the FX chain. */
  dispose() {
    if (this._layer) { this._layer.stop(0.1); this._layer = null; }
    const cut = (n) => { try { n.disconnect(); } catch (_) { /* ok */ } };
    [this._dry, this._dlWet, this._revWet, this._fb, this.input].forEach(cut);
  }
}
