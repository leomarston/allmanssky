// AllMansSky audio singleton — WebAudio only, everything synthesized live
// (no samples, no fetches). Lazy AudioContext created on first user gesture
// via init(). Master gain → gentle compressor → destination, with separate
// music / sfx / engine buses. Also listens for the documented 'audio:play'
// event so gameplay systems can fire sfx without importing this module.
import { events } from '../core/events.js';
import { MusicEngine } from './music.js';

let ctx = null;
let master = null;
let compressor = null;
let musicBus = null;
let sfxBus = null;
let engineBus = null;
let music = null;
let _muted = false;
let _pendingScene = null;
let _engine = null; // continuous ship-engine loop nodes
let _white = null;
let _brown = null;

const MASTER_LEVEL = 0.9;

function nowT() { return ctx.currentTime; }

function makeGain(v, dest) {
  const n = ctx.createGain();
  n.gain.value = v;
  if (dest) n.connect(dest);
  return n;
}

/** Cached noise buffers. Math.random is fine here — transient texture only. */
function getBuf(kind) {
  const sr = ctx.sampleRate;
  if (kind === 'brown') {
    if (!_brown) {
      const len = sr * 2;
      _brown = ctx.createBuffer(1, len, sr);
      const d = _brown.getChannelData(0);
      let b = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b = (b + 0.02 * w) / 1.02;
        d[i] = b * 3.5;
      }
    }
    return _brown;
  }
  if (!_white) {
    const len = sr;
    _white = ctx.createBuffer(1, len, sr);
    const d = _white.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return _white;
}

/**
 * One-shot oscillator with pitch envelope, optional filter, and either a
 * percussive (tau) or shaped (dur) amplitude envelope.
 */
function tone(out, t, {
  type = 'sine', f0 = 440, f1 = null, pt = null, dur = 0.15, vol = 0.25,
  a = 0.004, tau = null, detune = 0, lp = 0, lpEnd = 0, hp = 0, q = 0.8,
} = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(f0, 1), t);
  if (f1 != null && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + (pt || dur));
  if (detune) o.detune.value = detune;
  let head = o;
  if (lp || hp) {
    const f = ctx.createBiquadFilter();
    f.type = lp ? 'lowpass' : 'highpass';
    f.Q.value = q;
    const fStart = lp || hp;
    f.frequency.setValueAtTime(fStart, t);
    if (lp && lpEnd) f.frequency.exponentialRampToValueAtTime(Math.max(lpEnd, 20), t + (pt || dur));
    head.connect(f);
    head = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  let stopAt;
  if (tau != null) {
    g.gain.setTargetAtTime(0, t + a, tau);
    stopAt = t + a + tau * 8;
  } else {
    g.gain.setValueAtTime(vol, t + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, t + dur);
    stopAt = t + dur + 0.05;
  }
  head.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(stopAt);
}

/** One-shot filtered noise burst from the cached white/brown buffers. */
function noise(out, t, {
  buf = 'white', dur = 0.3, vol = 0.3, a = 0.005, tau = null,
  type = null, f0 = 1000, f1 = null, pt = null, q = 0.7, rate = 1,
} = {}) {
  const src = ctx.createBufferSource();
  src.buffer = getBuf(buf);
  src.loop = true;
  src.playbackRate.value = rate;
  let head = src;
  if (type) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1 != null && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t + (pt || dur));
    head.connect(f);
    head = f;
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + a);
  let stopAt;
  if (tau != null) {
    g.gain.setTargetAtTime(0, t + a, tau);
    stopAt = t + a + tau * 8;
  } else {
    g.gain.setValueAtTime(vol, t + dur * 0.55);
    g.gain.linearRampToValueAtTime(0, t + dur);
    stopAt = t + dur + 0.05;
  }
  head.connect(g);
  g.connect(out);
  src.start(t);
  src.stop(Math.max(stopAt, t + dur));
}

/** Small sine "bell": fundamental + quiet 2nd partial, exponential decay. */
function bellNote(out, t, f, vol, tau = 0.35) {
  tone(out, t, { type: 'sine', f0: f, vol, a: 0.006, tau });
  tone(out, t, { type: 'sine', f0: f * 2.01, vol: vol * 0.28, a: 0.006, tau: tau * 0.6 });
}

/**
 * One-shot echo send: returns a node that passes dry AND feeds a short
 * feedback delay into `out`; the whole chain self-disconnects after `life` s.
 */
function echoTail(out, time = 0.16, fb = 0.35, wet = 0.3, life = 2.5) {
  const inG = makeGain(1, out);
  const d = ctx.createDelay(1);
  d.delayTime.value = time;
  const f = makeGain(fb);
  const w = makeGain(wet, out);
  inG.connect(d);
  d.connect(f);
  f.connect(d);
  d.connect(w);
  setTimeout(() => {
    const cut = (n) => { try { n.disconnect(); } catch (_) { /* ok */ } };
    [inG, d, f, w].forEach(cut);
  }, life * 1000);
  return inG;
}

// ---------------------------------------------------------------------------
// SFX bank — each entry: (t, out) => schedules one sound on the sfx bus.
// ---------------------------------------------------------------------------
const SFX = {
  footstep(t, out) {
    // soft regolith crunch — retriggered by the walk cycle, so keep it subtle
    noise(out, t, {
      buf: 'brown', dur: 0.07, vol: 0.1, a: 0.004, tau: 0.028,
      type: 'lowpass', f0: 420 + Math.random() * 160, rate: 0.85 + Math.random() * 0.3,
    });
  },
  click(t, out) {
    tone(out, t, { type: 'square', f0: 1400, f1: 900, pt: 0.05, dur: 0.05, vol: 0.16, a: 0.002, tau: 0.018, lp: 2600 });
    noise(out, t, { dur: 0.02, vol: 0.05, a: 0.001, tau: 0.007, type: 'highpass', f0: 4200 });
  },
  hover(t, out) {
    tone(out, t, { type: 'sine', f0: 1550, f1: 1720, pt: 0.04, dur: 0.04, vol: 0.07, a: 0.003, tau: 0.016 });
  },
  confirm(t, out) {
    tone(out, t, { type: 'triangle', f0: 659.25, vol: 0.15, a: 0.004, tau: 0.06, lp: 3200 });
    tone(out, t + 0.07, { type: 'triangle', f0: 987.77, vol: 0.17, a: 0.004, tau: 0.12, lp: 3600 });
    tone(out, t + 0.07, { type: 'sine', f0: 1975.5, vol: 0.05, a: 0.004, tau: 0.1 });
  },
  deny(t, out) {
    tone(out, t, { type: 'square', f0: 233, f1: 185, pt: 0.16, dur: 0.18, vol: 0.13, a: 0.004, tau: 0.07, lp: 1200 });
    tone(out, t + 0.02, { type: 'square', f0: 220, f1: 172, pt: 0.16, dur: 0.18, vol: 0.11, a: 0.004, tau: 0.07, lp: 1100 });
  },
  scan(t, out) {
    const e = echoTail(out, 0.13, 0.4, 0.35, 2);
    tone(e, t, { type: 'sine', f0: 640, f1: 1980, pt: 0.32, dur: 0.36, vol: 0.16, a: 0.01, tau: 0.09 });
    tone(e, t, { type: 'sine', f0: 1280, f1: 3960, pt: 0.32, dur: 0.36, vol: 0.045, a: 0.01, tau: 0.08 });
  },
  scanDone(t, out) {
    bellNote(out, t, 1046.5, 0.2, 0.3);
    bellNote(out, t + 0.15, 1568, 0.22, 0.45);
  },
  mine(t, out) {
    // granular buzz burst — safe to retrigger in a loop while beam is held
    for (let i = 0; i < 2; i++) {
      noise(out, t + i * 0.1, {
        buf: 'brown', dur: 0.13, vol: 0.26, a: 0.02, tau: 0.05,
        type: 'bandpass', f0: 340 + Math.random() * 90, q: 1.4,
        rate: 0.9 + Math.random() * 0.3,
      });
    }
    tone(out, t, { type: 'sawtooth', f0: 84 + Math.random() * 6, f1: 74, pt: 0.22, dur: 0.24, vol: 0.12, a: 0.03, tau: 0.09, lp: 380 });
  },
  mineHit(t, out) {
    tone(out, t, { type: 'sine', f0: 2100, f1: 1500, pt: 0.05, dur: 0.06, vol: 0.22, a: 0.003, tau: 0.05 });
    tone(out, t, { type: 'sine', f0: 3150, vol: 0.07, a: 0.002, tau: 0.02 });
  },
  collect(t, out) {
    bellNote(out, t, 1318.5, 0.18, 0.18);
    bellNote(out, t + 0.07, 1760, 0.2, 0.3);
  },
  craft(t, out) {
    noise(out, t, { buf: 'brown', dur: 0.12, vol: 0.4, a: 0.002, tau: 0.05, type: 'lowpass', f0: 350 });
    tone(out, t, { type: 'sine', f0: 140, f1: 65, pt: 0.12, dur: 0.15, vol: 0.36, a: 0.003, tau: 0.07 });
    bellNote(out, t + 0.2, 880, 0.14, 0.3);
    bellNote(out, t + 0.32, 1318.5, 0.12, 0.35);
  },
  laser(t, out) {
    tone(out, t, { type: 'sawtooth', f0: 1600, f1: 220, pt: 0.16, dur: 0.2, vol: 0.2, a: 0.002, tau: 0.07, lp: 3800, lpEnd: 700 });
    tone(out, t, { type: 'square', f0: 800, f1: 160, pt: 0.14, dur: 0.18, vol: 0.09, a: 0.002, tau: 0.06, lp: 2200 });
    noise(out, t, { dur: 0.03, vol: 0.09, a: 0.001, tau: 0.01, type: 'highpass', f0: 3500 });
  },
  boltHit(t, out) {
    noise(out, t, { dur: 0.16, vol: 0.32, a: 0.002, tau: 0.05, type: 'bandpass', f0: 300, q: 0.9 });
    tone(out, t, { type: 'sine', f0: 170, f1: 60, pt: 0.1, dur: 0.12, vol: 0.28, a: 0.002, tau: 0.06 });
  },
  explosion(t, out) {
    noise(out, t, { buf: 'brown', dur: 1.3, vol: 0.7, a: 0.004, tau: 0.38, type: 'lowpass', f0: 1200, f1: 70, pt: 1.0, q: 0.6 });
    tone(out, t, { type: 'sine', f0: 76, f1: 30, pt: 0.5, dur: 1.0, vol: 0.55, a: 0.003, tau: 0.3 });
    noise(out, t, { dur: 0.05, vol: 0.18, a: 0.001, tau: 0.015, type: 'highpass', f0: 1800 });
  },
  hurt(t, out) {
    tone(out, t, { type: 'sawtooth', f0: 138, f1: 118, pt: 0.2, dur: 0.25, vol: 0.18, a: 0.003, tau: 0.12, lp: 620 });
    tone(out, t, { type: 'sawtooth', f0: 147, f1: 121, pt: 0.2, dur: 0.25, vol: 0.16, a: 0.003, tau: 0.12, lp: 600 });
    noise(out, t, { buf: 'brown', dur: 0.1, vol: 0.22, a: 0.002, tau: 0.04, type: 'lowpass', f0: 300 });
  },
  jetpack(t, out) {
    noise(out, t, { dur: 0.4, vol: 0.15, a: 0.06, tau: 0.12, type: 'bandpass', f0: 750, f1: 1250, pt: 0.3, q: 0.6 });
  },
  land(t, out) {
    tone(out, t, { type: 'sine', f0: 95, f1: 42, pt: 0.15, dur: 0.18, vol: 0.3, a: 0.004, tau: 0.09 });
    noise(out, t, { buf: 'brown', dur: 0.1, vol: 0.16, a: 0.004, tau: 0.04, type: 'lowpass', f0: 260 });
  },
  takeoff(t, out) {
    noise(out, t, { buf: 'brown', dur: 1.3, vol: 0.38, a: 0.25, tau: 0.35, type: 'lowpass', f0: 160, f1: 950, pt: 1.1 });
    tone(out, t, { type: 'sawtooth', f0: 46, f1: 118, pt: 1.1, dur: 1.3, vol: 0.15, a: 0.3, tau: 0.3, lp: 500, lpEnd: 1200 });
    tone(out, t, { type: 'sawtooth', f0: 46.5, f1: 119, pt: 1.1, dur: 1.3, vol: 0.12, a: 0.3, tau: 0.3, lp: 500, lpEnd: 1200, detune: 8 });
  },
  warp(t, out) {
    const e = echoTail(out, 0.18, 0.3, 0.25, 4);
    tone(e, t, { type: 'sawtooth', f0: 108, f1: 432, pt: 1.5, dur: 1.6, vol: 0.14, a: 0.8, tau: 0.25, lp: 600, lpEnd: 2600 });
    tone(e, t, { type: 'sawtooth', f0: 109, f1: 436, pt: 1.5, dur: 1.6, vol: 0.12, a: 0.8, tau: 0.25, lp: 600, lpEnd: 2600, detune: -9 });
    noise(e, t, { dur: 1.6, vol: 0.16, a: 1.0, tau: 0.3, type: 'bandpass', f0: 400, f1: 2400, pt: 1.5, q: 0.8 });
    tone(e, t, { type: 'sine', f0: 880, f1: 1760, pt: 1.4, dur: 1.5, vol: 0.05, a: 1.2, tau: 0.2 });
    noise(e, t + 1.45, { dur: 0.9, vol: 0.45, a: 0.02, tau: 0.3, type: 'bandpass', f0: 2400, f1: 260, pt: 0.8, q: 0.7 });
    tone(e, t + 1.45, { type: 'sine', f0: 60, f1: 32, pt: 0.5, dur: 0.8, vol: 0.35, a: 0.01, tau: 0.35 });
  },
  dock(t, out) {
    noise(out, t, { dur: 0.55, vol: 0.18, a: 0.01, tau: 0.2, type: 'highpass', f0: 1400 });
    tone(out, t + 0.4, { type: 'sine', f0: 120, f1: 58, pt: 0.08, dur: 0.12, vol: 0.36, a: 0.003, tau: 0.06 });
    noise(out, t + 0.4, { buf: 'brown', dur: 0.08, vol: 0.26, a: 0.002, tau: 0.03, type: 'lowpass', f0: 300 });
    tone(out, t + 0.41, { type: 'triangle', f0: 620, vol: 0.09, a: 0.003, tau: 0.12 });
    tone(out, t + 0.41, { type: 'triangle', f0: 936, vol: 0.05, a: 0.003, tau: 0.1 });
  },
  notify(t, out) {
    tone(out, t, { type: 'sine', f0: 987.77, vol: 0.13, a: 0.015, tau: 0.16 });
    tone(out, t + 0.16, { type: 'sine', f0: 1318.5, vol: 0.14, a: 0.015, tau: 0.22 });
  },
  discovery(t, out) {
    const e = echoTail(out, 0.23, 0.35, 0.3, 3.5);
    const arp = [783.99, 987.77, 1174.66, 1567.98];
    arp.forEach((f, i) => bellNote(e, t + i * 0.12, f, 0.15 + i * 0.015, 0.4));
  },
  death(t, out) {
    const e = echoTail(out, 0.31, 0.4, 0.35, 5);
    tone(e, t, { type: 'triangle', f0: 392, f1: 196, pt: 1.8, dur: 2.0, vol: 0.16, a: 0.15, tau: 0.5, lp: 1400, lpEnd: 500 });
    tone(e, t, { type: 'triangle', f0: 396, f1: 197, pt: 1.8, dur: 2.0, vol: 0.13, a: 0.15, tau: 0.5, lp: 1400, lpEnd: 500 });
    tone(e, t, { type: 'sine', f0: 98, f1: 49, pt: 1.8, dur: 2.0, vol: 0.18, a: 0.2, tau: 0.5 });
    tone(e, t, { type: 'sine', f0: 55, dur: 2.2, vol: 0.1, a: 0.5, tau: 0.6 });
  },
};

// ---------------------------------------------------------------------------
// Continuous ship-engine loop: brown noise + detuned saw pair through a
// lowpass; level maps to cutoff / pitch / gain with smooth ramps.
// ---------------------------------------------------------------------------
function ensureEngineLoop() {
  if (_engine) return _engine;
  const out = makeGain(0, engineBus);
  const filt = ctx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = 140;
  filt.Q.value = 0.9;
  filt.connect(out);

  const nSrc = ctx.createBufferSource();
  nSrc.buffer = getBuf('brown');
  nSrc.loop = true;
  nSrc.playbackRate.value = 0.6;
  const nG = makeGain(0.55, filt);
  nSrc.connect(nG);

  const sawA = ctx.createOscillator();
  sawA.type = 'sawtooth';
  sawA.frequency.value = 42;
  const sawB = ctx.createOscillator();
  sawB.type = 'sawtooth';
  sawB.frequency.value = 42.5;
  sawB.detune.value = 9;
  sawA.connect(makeGain(0.16, filt));
  sawB.connect(makeGain(0.13, filt));

  // slow detune wobble for a living machine feel
  const wobble = ctx.createOscillator();
  wobble.frequency.value = 1.3;
  const wG = makeGain(4);
  wobble.connect(wG);
  wG.connect(sawA.detune);
  wG.connect(sawB.detune);

  const t = nowT();
  nSrc.start(t);
  sawA.start(t);
  sawB.start(t);
  wobble.start(t);
  _engine = { out, filt, nSrc, sawA, sawB };
  return _engine;
}

/**
 * Global audio singleton for AllMansSky.
 *
 * All sound is synthesized with WebAudio at call time — there are no assets.
 * Call {@link audio.init} from the first user gesture (click/keydown); every
 * other method safely no-ops until then (setScene remembers the last request
 * and applies it on init).
 *
 * @namespace audio
 * @property {boolean} muted whether output is currently muted
 */
export const audio = {
  /** @returns {boolean} current mute state */
  get muted() { return _muted; },

  /**
   * Create (or resume) the AudioContext and the bus graph:
   * music/sfx/engine buses → master gain → gentle compressor → speakers.
   * Idempotent; call on the first user gesture.
   */
  init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.28;
    compressor.connect(ctx.destination);

    master = makeGain(_muted ? 0 : MASTER_LEVEL, compressor);
    musicBus = makeGain(0.75, master);
    sfxBus = makeGain(1.0, master);
    engineBus = makeGain(0.8, master);

    music = new MusicEngine(ctx, musicBus);
    if (_pendingScene) {
      music.setScene(_pendingScene[0], _pendingScene[1]);
      _pendingScene = null;
    }
    ctx.resume().catch(() => {});
  },

  /**
   * Switch the generative music mood (3 s crossfade).
   * @param {'menu'|'space'|'surface'} kind
   * @param {{biome?: string, danger?: number}} [mood] biome tints surface
   *   moods (lush/frozen/volcanic…); danger 0..1 raises a tense low pulse.
   */
  setScene(kind, mood = {}) {
    if (!ctx || !music) { _pendingScene = [kind, mood]; return; }
    music.setScene(kind, mood);
  },

  /**
   * Fire a one-shot sound effect.
   * @param {'click'|'hover'|'confirm'|'deny'|'scan'|'scanDone'|'mine'|'mineHit'|
   *   'collect'|'craft'|'laser'|'boltHit'|'explosion'|'hurt'|'jetpack'|'land'|
   *   'takeoff'|'warp'|'dock'|'notify'|'discovery'|'death'} name
   * @param {{volume?: number, pan?: number}} [opts] volume multiplier (default
   *   1) and stereo pan -1..1.
   */
  sfx(name, opts = {}) {
    if (!ctx) return;
    const fn = SFX[name];
    if (!fn) return;
    let out = sfxBus;
    const vol = opts.volume ?? 1;
    if (vol !== 1 || (opts.pan && ctx.createStereoPanner)) {
      out = ctx.createGain();
      out.gain.value = vol;
      let tail = out;
      if (opts.pan && ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, opts.pan));
        tail.connect(p);
        tail = p;
      }
      tail.connect(sfxBus);
    }
    fn(nowT() + 0.003, out);
  },

  /**
   * Continuous ship engine loop. Call every frame (or on throttle change);
   * level maps to cutoff/pitch/gain with smooth ramps. 0 = silent.
   * @param {number} level0to1 throttle 0..1
   */
  engine(level0to1) {
    if (!ctx) return;
    const l = Math.min(1, Math.max(0, level0to1 || 0));
    const e = ensureEngineLoop();
    const t = nowT();
    const target = l <= 0.002 ? 0 : 0.07 + 0.55 * Math.pow(l, 1.3);
    e.out.gain.setTargetAtTime(target, t, 0.09);
    e.filt.frequency.setTargetAtTime(130 + 1900 * l * l, t, 0.15);
    const base = 40 + 88 * l;
    e.sawA.frequency.setTargetAtTime(base, t, 0.2);
    e.sawB.frequency.setTargetAtTime(base * 1.011, t, 0.2);
    e.nSrc.playbackRate.setTargetAtTime(0.5 + 1.3 * l, t, 0.2);
  },

  /**
   * Mute/unmute all output (short ramp, state kept across init).
   * @param {boolean} b
   */
  setMuted(b) {
    _muted = !!b;
    if (ctx && master) master.gain.setTargetAtTime(_muted ? 0 : MASTER_LEVEL, nowT(), 0.04);
  },
};

// Gameplay systems may fire sfx via the documented event bus channel.
events.on('audio:play', (name, opts) => audio.sfx(name, opts || {}));
