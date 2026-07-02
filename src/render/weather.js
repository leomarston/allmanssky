// Weather VFX: pooled particle fields that follow the player, plus lightning
// for thunder worlds and drifting motes on clear days. Intensity waxes and
// wanes on a slow seeded cycle; survival reads .intensity for hazard scaling.
//
// CONTRACT: new WeatherSystem(scene, planetDef, seed)
//   .update(dt, playerPos, sunElevation)   .intensity (0..1)   .dispose()
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';
import { audio } from '../audio/audio.js';

const RANGE = 38;        // particle box half-extent around the player
const TOP = 26, BOTTOM = -6;

const KIND_CONF = {
  rain:      { count: 1400, size: [0.03, 1.5], color: 0x9db8cc, speed: [26, 34], sway: 0.25, opacity: 0.5 },
  toxicrain: { count: 1200, size: [0.035, 1.3], color: 0x9fd45f, speed: [16, 22], sway: 0.4, opacity: 0.5 },
  snow:      { count: 900,  size: [0.09, 0.09], color: 0xeef4fb, speed: [1.6, 3.2], sway: 1.6, opacity: 0.85 },
  sandstorm: { count: 1500, size: [0.06, 0.5], color: 0xd8b070, speed: [3, 6], sway: 0.5, opacity: 0.55, horizontal: 26 },
  ashfall:   { count: 700,  size: [0.08, 0.1], color: 0x4a4442, speed: [1.2, 2.4], sway: 0.9, opacity: 0.9 },
  thunder:   { count: 1600, size: [0.03, 1.7], color: 0x9db8cc, speed: [30, 40], sway: 0.3, opacity: 0.55 },
};

export class WeatherSystem {
  constructor(scene, planetDef, seed = 1) {
    this.scene = scene;
    this.def = planetDef;
    this.kind = planetDef.weather ?? 'clear';
    this.rng = new RNG(hash32(seed >>> 0, 0x3ea7));
    this.intensity = 0;
    this._t = this.rng.range(0, 1000);
    this._cyclePeriod = this.rng.range(500, 900);   // seconds per wax/wane cycle
    this.group = new THREE.Group();
    this.group.name = 'weather';
    scene.add(this.group);
    this._flash = null;
    this._flashT = 0;
    this._nextBolt = this.rng.range(6, 18);

    const conf = KIND_CONF[this.kind];
    if (conf) this._buildParticles(conf);
    else if (this.kind === 'clear') this._buildMotes();
  }

  _buildParticles(conf) {
    this.conf = conf;
    const n = conf.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 2);   // fall speed, sway phase
    for (let i = 0; i < n; i++) this._respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;

    // streak sprite: vertical soft line for rain, dot for snow/ash
    const isStreak = conf.size[1] > conf.size[0] * 4;
    const cv = document.createElement('canvas');
    cv.width = 16; cv.height = 64;
    const g2 = cv.getContext('2d');
    const grad = g2.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g2.fillStyle = grad;
    if (isStreak) g2.fillRect(6, 0, 4, 64);
    else { g2.beginPath(); g2.arc(8, 32, 7, 0, 6.29); g2.fillStyle = 'rgba(255,255,255,1)'; g2.fill(); }
    this.tex = new THREE.CanvasTexture(cv);

    this.mat = new THREE.PointsMaterial({
      map: this.tex, color: conf.color, transparent: true, opacity: 0,
      size: isStreak ? 1.1 : 0.22, sizeAttenuation: true,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);

    if (this.kind === 'thunder') {
      this._flash = new THREE.DirectionalLight(0xcfe8ff, 0);
      this._flash.position.set(60, 120, -40);
      this.group.add(this._flash);
      this.group.add(this._flash.target);
    }
  }

  _buildMotes() {
    // faint drifting pollen/dust for still days — cheap life
    const n = 130;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 2);
    this.conf = { count: n, speed: [0.12, 0.3], sway: 1.2, opacity: 0.35, color: 0xfff2c8 };
    for (let i = 0; i < n; i++) this._respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    this.mat = new THREE.PointsMaterial({
      color: this.conf.color, transparent: true, opacity: 0.0, size: 0.05,
      sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.intensity = 0;
  }

  _respawn(i, anywhere = false) {
    const r = this.rng;
    this.pos[i * 3] = r.range(-RANGE, RANGE);
    this.pos[i * 3 + 1] = anywhere ? r.range(BOTTOM, TOP) : TOP;
    this.pos[i * 3 + 2] = r.range(-RANGE, RANGE);
    this.vel[i * 2] = r.range(this.conf.speed[0], this.conf.speed[1]);
    this.vel[i * 2 + 1] = r.range(0, 6.28);
  }

  update(dt, playerPos, sunElevation = 1) {
    if (!this.points) return;
    this._t += dt;
    this.group.position.copy(playerPos);

    // slow seeded intensity cycle (clear worlds stay at gentle mote level)
    if (this.kind !== 'clear') {
      const c = Math.sin((this._t / this._cyclePeriod) * Math.PI * 2);
      this.intensity = THREE.MathUtils.clamp(c * 1.4 + 0.35, 0, 1);
    } else {
      this.intensity = 0;
    }
    const vis = this.kind === 'clear' ? 0.35 : this.conf.opacity * this.intensity;
    this.mat.opacity += (vis - this.mat.opacity) * Math.min(1, dt);

    const n = this.conf.count;
    const horiz = this.conf.horizontal ?? 0;
    for (let i = 0; i < n; i++) {
      const fall = this.vel[i * 2], ph = this.vel[i * 2 + 1];
      this.pos[i * 3 + 1] -= fall * dt;
      this.pos[i * 3] += Math.sin(this._t * 1.3 + ph) * this.conf.sway * dt + horiz * dt;
      this.pos[i * 3 + 2] += Math.cos(this._t * 1.1 + ph) * this.conf.sway * dt * 0.6;
      if (this.pos[i * 3 + 1] < BOTTOM
        || Math.abs(this.pos[i * 3]) > RANGE + 4
        || Math.abs(this.pos[i * 3 + 2]) > RANGE + 4) {
        this._respawn(i);
      }
    }
    this.geo.attributes.position.needsUpdate = true;

    // lightning
    if (this._flash) {
      this._nextBolt -= dt * (0.4 + this.intensity);
      if (this._nextBolt <= 0) {
        this._nextBolt = this.rng.range(7, 22);
        this._flashT = 0.28;
        audio.sfx('explosion', { volume: 0.16 });
      }
      if (this._flashT > 0) {
        this._flashT -= dt;
        const s = this._flashT > 0.2 ? 8 : this._flashT > 0.12 ? 1.5 : this._flashT > 0.06 ? 6 : 0.5;
        this._flash.intensity = s * this.intensity;
      } else {
        this._flash.intensity = 0;
      }
    }
  }

  dispose() {
    if (this.points) {
      this.group.remove(this.points);
      this.geo.dispose();
      this.mat.dispose();
      this.tex?.dispose();
    }
    this.scene.remove(this.group);
  }
}
