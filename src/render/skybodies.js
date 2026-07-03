// Sister planets and moons hanging in the surface sky. Each other planet in
// the system renders as a soft shaded disc sprite on the sky shell, drifting
// slowly with the day cycle, brightening at dusk and night — the constant
// reminder that this world is one of several.
import * as THREE from 'three';
import { RNG, hash32 } from '../core/rng.js';

const SHELL = 3300;    // just inside the sky dome (3600)

function drawBodySprite(def, rng) {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const c = size / 2, r = size * 0.34;

  const base = new THREE.Color(def.palette?.mid ?? '#8899aa');
  const hi = base.clone().lerp(new THREE.Color('#ffffff'), 0.35);
  const lo = base.clone().multiplyScalar(0.35);

  // lit sphere illusion: offset radial gradient + hard-ish terminator
  const grad = g.createRadialGradient(c - r * 0.45, c - r * 0.4, r * 0.1, c, c, r);
  grad.addColorStop(0, `rgb(${hi.r * 255 | 0},${hi.g * 255 | 0},${hi.b * 255 | 0})`);
  grad.addColorStop(0.62, `rgb(${base.r * 255 | 0},${base.g * 255 | 0},${base.b * 255 | 0})`);
  grad.addColorStop(1, `rgb(${lo.r * 255 | 0},${lo.g * 255 | 0},${lo.b * 255 | 0})`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();

  // faint band detail for character
  g.globalAlpha = 0.16;
  g.strokeStyle = '#000';
  for (let i = 0; i < 3; i++) {
    const y = c + (rng.next() - 0.5) * r * 1.2;
    g.lineWidth = 2 + rng.next() * 5;
    g.beginPath();
    g.ellipse(c, y, r * 0.92, r * 0.2, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 1;

  // rings
  if (def.rings) {
    g.strokeStyle = `rgba(220,210,190,0.55)`;
    g.lineWidth = size * 0.02;
    g.beginPath();
    g.ellipse(c, c, r * 1.6, r * 0.42, -0.35, 0, Math.PI * 2);
    g.stroke();
  }

  // soft atmosphere halo
  const halo = g.createRadialGradient(c, c, r, c, c, r * 1.28);
  const ac = new THREE.Color(def.atmosphere?.colorHex ?? '#88bbff');
  halo.addColorStop(0, `rgba(${ac.r * 255 | 0},${ac.g * 255 | 0},${ac.b * 255 | 0},0.28)`);
  halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SkyBodies {
  /**
   * @param {THREE.Scene} scene
   * @param {object} system StarSystem
   * @param {number} hereIndex index of the planet we're standing on
   */
  constructor(scene, system, hereIndex) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'skybodies';
    this.group.renderOrder = -5;
    scene.add(this.group);
    this.bodies = [];
    this._textures = [];

    const rng = new RNG(hash32(system.seed ?? 1, 0x51b0d));
    system.planets.forEach((def, i) => {
      if (i === hereIndex) return;
      const tex = drawBodySprite(def, rng.fork(`b${i}`));
      this._textures.push(tex);
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.85,
        depthWrite: false, depthTest: false,
      });
      const spr = new THREE.Sprite(mat);
      // apparent size: closer orbital neighbors look bigger
      const gap = Math.abs(i - hereIndex);
      const scale = THREE.MathUtils.clamp(300 / (gap + 0.6), 90, 340) * (def.radius / 60);
      spr.scale.setScalar(scale);
      this.group.add(spr);
      this.bodies.push({
        spr, mat,
        az: (i * 2.399963) % (Math.PI * 2),        // golden-angle spread
        el: 0.14 + ((i * 37) % 10) / 10 * 0.42,    // 8°..32° up
        drift: 0.02 + (i % 3) * 0.012,
      });
    });
  }

  update(dt, camPos, sunElev, timeOfDay) {
    if (!this.bodies.length) return;
    this.group.position.copy(camPos);
    // bodies wash out in full day, own the dusk and night
    const day = THREE.MathUtils.clamp((sunElev + 0.05) / 0.3, 0, 1);
    const vis = 0.18 + (1 - day) * 0.82;
    for (const b of this.bodies) {
      const az = b.az + timeOfDay * Math.PI * 2 * b.drift;
      const cosE = Math.cos(b.el);
      b.spr.position.set(
        Math.cos(az) * cosE * SHELL,
        Math.sin(b.el) * SHELL,
        Math.sin(az) * cosE * SHELL,
      );
      b.mat.opacity = vis;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const t of this._textures) t.dispose();
    for (const b of this.bodies) b.mat.dispose();
    this.bodies.length = 0;
  }
}
