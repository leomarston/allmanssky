// Pooled VFX: engine trails, explosions, sparks, mining beams, warp tunnel,
// landing dust, laser bolts. Everything preallocated (points pools, sprite
// pools, instanced bolts) — zero per-frame allocation. Transient jitter uses
// Math.random() per the determinism rules (VFX only, never world content).
import * as THREE from 'three';

const GLOW_CAP = 4096;
const SMOKE_CAP = 1024;
const FLASH_CAP = 10;
const BOLT_CAP = 64;
const WARP_LINES = 320;
const BOLT_MAX_LIFE = 3;

// --- procedural sprite textures ---------------------------------------------

function softDotTexture(size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.13)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.028)');
  g.addColorStop(0.84, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function flashTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.16, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.16)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.05)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.014)');
  g.addColorStop(0.96, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function puffTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const half = size / 2;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.16;
    const x = half + Math.cos(a) * r, y = half + Math.sin(a) * r;
    const br = size * (0.1 + Math.random() * 0.13);
    const g = ctx.createRadialGradient(x, y, 0, x, y, br);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // Circular falloff mask so no blob ever meets the quad edge (boxy sprites).
  ctx.globalCompositeOperation = 'destination-in';
  const m = ctx.createRadialGradient(half, half, 0, half, half, half);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(0.55, 'rgba(0,0,0,0.85)');
  m.addColorStop(0.85, 'rgba(0,0,0,0)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = m;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function beamStripeTexture() {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillRect(0, 0, 4, 128);
  ctx.fillStyle = 'rgba(255,255,255,1)';
  for (let y = 0; y < 128; y += 16) ctx.fillRect(0, y + Math.random() * 6, 4, 5 + Math.random() * 5);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// --- points particle pool ----------------------------------------------------

const POINT_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
attribute float aSize;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (600.0 / -mv.z), 1.0, 512.0);
  gl_Position = projectionMatrix * mv;
}
`;

const POINT_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

class PointPool {
  constructor(capacity, map, blending) {
    this.cap = capacity;
    this.alive = 0;
    this._hadAlive = false;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.alp = new Float32Array(capacity);
    this.siz = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.sizeVel = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      uniforms: { uMap: { value: map } },
      blending,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  spawn(px, py, pz, vx, vy, vz, r, g, b, alpha, size, life, drag, grav, sizeVel) {
    if (this.alive >= this.cap) return;
    const i = this.alive++;
    this.pos[i * 3] = px; this.pos[i * 3 + 1] = py; this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.alp[i] = alpha;
    this.siz[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.alpha0[i] = alpha;
    this.drag[i] = drag; this.grav[i] = grav; this.sizeVel[i] = sizeVel;
  }

  _copy(from, to) {
    this.pos[to * 3] = this.pos[from * 3]; this.pos[to * 3 + 1] = this.pos[from * 3 + 1]; this.pos[to * 3 + 2] = this.pos[from * 3 + 2];
    this.vel[to * 3] = this.vel[from * 3]; this.vel[to * 3 + 1] = this.vel[from * 3 + 1]; this.vel[to * 3 + 2] = this.vel[from * 3 + 2];
    this.col[to * 3] = this.col[from * 3]; this.col[to * 3 + 1] = this.col[from * 3 + 1]; this.col[to * 3 + 2] = this.col[from * 3 + 2];
    this.alp[to] = this.alp[from]; this.siz[to] = this.siz[from];
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.alpha0[to] = this.alpha0[from];
    this.drag[to] = this.drag[from]; this.grav[to] = this.grav[from]; this.sizeVel[to] = this.sizeVel[from];
  }

  update(dt) {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alive--;
        if (i !== this.alive) this._copy(this.alive, i);
        continue;
      }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k + this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.siz[i] = Math.max(0.01, this.siz[i] + this.sizeVel[i] * dt);
      const t = this.life[i] / this.maxLife[i];
      this.alp[i] = this.alpha0[i] * t * Math.min(1, (1 - t) * 8 + 0.2);
      i++;
    }
    if (this.alive > 0 || this._hadAlive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
      this.geo.setDrawRange(0, this.alive);
    }
    this._hadAlive = this.alive > 0;
  }

  dispose() {
    this.points.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

// -----------------------------------------------------------------------------

/**
 * Pooled particle/VFX system. One instance per scene; every effect draws from
 * preallocated pools so steady-state cost is flat and allocation-free.
 */
export class EffectsSystem {
  /** @param {THREE.Scene} scene scene that will own all effect objects */
  constructor(scene) {
    this.scene = scene;
    this._t = 0;
    this._dotTex = softDotTexture();
    this._flashTex = flashTexture();
    this._puffTex = puffTexture();
    this._stripeTex = beamStripeTexture();

    this._glow = new PointPool(GLOW_CAP, this._dotTex, THREE.AdditiveBlending);
    this._smoke = new PointPool(SMOKE_CAP, this._puffTex, THREE.NormalBlending);
    scene.add(this._glow.points, this._smoke.points);

    // flash sprite pool (explosions)
    this._flashes = [];
    for (let i = 0; i < FLASH_CAP; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this._flashTex, blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, opacity: 0,
      });
      const spr = new THREE.Sprite(mat);
      spr.visible = false;
      spr.renderOrder = 11;
      scene.add(spr);
      this._flashes.push({ spr, mat, life: 0, maxLife: 1, s0: 1, s1: 2 });
    }

    // laser bolts: one instanced mesh
    const boltGeo = new THREE.CapsuleGeometry(0.22, 3.4, 3, 8);
    boltGeo.rotateX(Math.PI / 2); // length along +Z
    this._boltMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    this._boltMesh = new THREE.InstancedMesh(boltGeo, this._boltMat, BOLT_CAP);
    this._boltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._boltMesh.frustumCulled = false;
    this._boltMesh.renderOrder = 10;
    this._bolts = [];
    for (let i = 0; i < BOLT_CAP; i++) {
      this._bolts.push({
        handle: { position: new THREE.Vector3(), alive: false },
        dir: new THREE.Vector3(), speed: 0, life: 0,
        quat: new THREE.Quaternion(),
      });
      this._boltMesh.setMatrixAt(i, _M0);
      this._boltMesh.setColorAt(i, _WHITE);
    }
    this._boltMesh.instanceMatrix.needsUpdate = true;
    scene.add(this._boltMesh);

    this._trails = [];
    this._beams = [];
    this._warps = [];

    // shared unit cylinder for beams (axis +Y, height 1)
    this._beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
  }

  // --- continuous effects ------------------------------------------------

  /**
   * Attach a glowing exhaust stream to an object.
   * @param {THREE.Object3D} followObj emitter anchor (its world position)
   * @param {number|string} colorHex trail tint
   * @returns {{setLevel(level:number):void, dispose():void}} level 0..1 drives
   *   emission rate and brightness.
   */
  engineTrail(followObj, colorHex) {
    const trail = {
      obj: followObj,
      color: new THREE.Color(colorHex ?? 0x7de8ff),
      level: 0, accum: 0, alive: true,
      last: new THREE.Vector3(), hasLast: false,
    };
    this._trails.push(trail);
    return {
      setLevel(level) { trail.level = Math.max(0, Math.min(1, level)); },
      dispose() { trail.alive = false; },
    };
  }

  /**
   * Glowing mining/cutting beam between two points: bright core, soft outer
   * sheath, pulsing impact glow at the target.
   * @param {THREE.Vector3} from @param {THREE.Vector3} to
   * @param {number|string} colorHex
   * @returns {{set(from:THREE.Vector3, to:THREE.Vector3):void, off():void}}
   */
  miningBeam(from, to, colorHex) {
    let beam = null;
    for (const b of this._beams) if (!b.active) { beam = b; break; }
    if (!beam) beam = this._makeBeam();
    const col = _C1.set(colorHex ?? 0xffca6b);
    beam.coreMat.color.setRGB(col.r * 4, col.g * 4, col.b * 4);
    beam.glowMat.color.setRGB(col.r * 1.3, col.g * 1.3, col.b * 1.3);
    beam.impactMat.color.setRGB(col.r * 5, col.g * 5, col.b * 5);
    beam.active = true;
    beam.group.visible = true;
    beam.phase = Math.random() * Math.PI * 2;
    this._setBeam(beam, from, to);
    const self = this;
    return {
      set(f, t) { if (beam.active) self._setBeam(beam, f, t); },
      off() { beam.active = false; beam.group.visible = false; },
    };
  }

  /**
   * Star-lines streaking past the camera during warp.
   * @param {THREE.Camera} camera camera the tunnel tracks
   * @returns {{setLevel(level:number):void, dispose():void}} level 0..1 drives
   *   speed, streak length and opacity; 0 hides it.
   */
  warpTunnel(camera) {
    const n = WARP_LINES;
    const posArr = new Float32Array(n * 2 * 3);
    const colArr = new Float32Array(n * 2 * 3);
    const line = new Float32Array(n * 4); // x, y, zHead, speedJitter
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.5 + Math.pow(Math.random(), 0.6) * 26;
      line[i * 4] = Math.cos(a) * r;
      line[i * 4 + 1] = Math.sin(a) * r;
      line[i * 4 + 2] = -170 + Math.random() * 190;
      line[i * 4 + 3] = 0.6 + Math.random() * 0.9;
      const c = 0.55 + Math.random() * 0.45;
      colArr[i * 6] = 1.8 * c; colArr[i * 6 + 1] = 2.4 * c; colArr[i * 6 + 2] = 3.6 * c; // head
      colArr[i * 6 + 3] = 0.02; colArr[i * 6 + 4] = 0.05; colArr[i * 6 + 5] = 0.14;      // tail
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0, depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 12;
    lines.visible = false;
    this.scene.add(lines);
    const warp = { camera, lines, geo, mat, line, level: 0, alive: true };
    this._warps.push(warp);
    return {
      setLevel(level) { warp.level = Math.max(0, Math.min(1, level)); },
      dispose() { warp.alive = false; },
    };
  }

  // --- one-shot effects ----------------------------------------------------

  /**
   * Detonation: HDR ember burst + expanding flash sprite + lingering smoke.
   * @param {THREE.Vector3} pos @param {number} [scale=1] size multiplier
   * @param {number|string} [colorHex] ember tint (default hot orange)
   */
  explosion(pos, scale = 1, colorHex) {
    const col = _C1.set(colorHex ?? 0xff9448);
    const hot = _C2.copy(col).lerp(_WHITE, 0.55);
    this._flash(pos, 1.6 * scale, 9 * scale, 0.38, hot, 1.7);
    const nE = Math.round(34 * Math.min(scale, 2.5));
    for (let i = 0; i < nE; i++) {
      _rndDir(_V1);
      const sp = (5 + Math.random() * 21) * scale;
      const w = Math.random();
      const r = w < 0.3 ? hot.r * 3.4 : col.r * 2.6, g = w < 0.3 ? hot.g * 3.4 : col.g * 2.6, b = w < 0.3 ? hot.b * 3.4 : col.b * 2.6;
      const off = (0.3 + Math.random() * 0.6) * scale; // never all coincident
      this._glow.spawn(
        pos.x + _V1.x * off, pos.y + _V1.y * off, pos.z + _V1.z * off,
        _V1.x * sp, _V1.y * sp, _V1.z * sp,
        r, g, b, 1,
        (0.5 + Math.random() * 0.9) * scale, 0.6 + Math.random() * 0.9,
        1.3, 0, -0.15 * scale
      );
    }
    for (let i = 0; i < 12; i++) {
      _rndDir(_V1);
      const sp = 0.8 + Math.random() * 2.6 * scale;
      this._smoke.spawn(
        pos.x, pos.y, pos.z, _V1.x * sp, _V1.y * sp + 0.5, _V1.z * sp,
        0.14, 0.125, 0.115, 0.3,
        (1.0 + Math.random() * 1.2) * scale, 1.5 + Math.random() * 1.3,
        0.9, 0.3, 2.0 * scale
      );
    }
  }

  /**
   * Impact sparks scattering off a surface.
   * @param {THREE.Vector3} pos @param {THREE.Vector3} normal surface normal
   * @param {number|string} [colorHex] spark tint (default warm gold)
   */
  sparks(pos, normal, colorHex) {
    const col = _C1.set(colorHex ?? 0xffd27a);
    for (let i = 0; i < 14; i++) {
      _rndDir(_V1).multiplyScalar(0.85).add(normal).normalize();
      const sp = 6 + Math.random() * 13;
      this._glow.spawn(
        pos.x, pos.y, pos.z, _V1.x * sp, _V1.y * sp, _V1.z * sp,
        col.r * 4.5, col.g * 4.5, col.b * 4.5, 1,
        0.24 + Math.random() * 0.3, 0.18 + Math.random() * 0.4,
        0.4, -9, 0
      );
    }
  }

  /**
   * Radial dust kicked up by a landing ship.
   * @param {THREE.Vector3} pos ground contact point
   */
  landingDust(pos) {
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + Math.random() * 0.4;
      const sp = 3 + Math.random() * 5.5;
      this._smoke.spawn(
        pos.x, pos.y + 0.3, pos.z,
        Math.cos(a) * sp, 0.4 + Math.random() * 0.9, Math.sin(a) * sp,
        0.42, 0.36, 0.28, 0.28,
        0.9 + Math.random() * 0.7, 1.0 + Math.random() * 1.0,
        1.6, -0.4, 2.6
      );
    }
  }

  /**
   * Fire a bright capsule tracer. The returned handle is live: read
   * `.position` for collision tests, set/read `.alive` (auto-expires ~3 s).
   * @param {THREE.Vector3} from muzzle position
   * @param {THREE.Vector3} dir normalized direction
   * @param {number} speed units/second
   * @param {number|string} colorHex bolt tint
   * @returns {{position: THREE.Vector3, alive: boolean}}
   */
  laserBolt(from, dir, speed, colorHex) {
    let slot = null, oldest = null, oldestLife = -1;
    for (const s of this._bolts) {
      if (!s.handle.alive) { slot = s; break; }
      if (s.life > oldestLife) { oldestLife = s.life; oldest = s; }
    }
    if (!slot) slot = oldest;
    slot.handle.position.copy(from);
    slot.handle.alive = true;
    slot.dir.copy(dir).normalize();
    slot.speed = speed;
    slot.life = 0;
    slot.quat.setFromUnitVectors(_Z, slot.dir);
    const col = _C1.set(colorHex ?? 0xff5470);
    const i = this._bolts.indexOf(slot);
    this._boltMesh.setColorAt(i, _C2.setRGB(col.r * 4.5, col.g * 4.5, col.b * 4.5));
    this._boltMesh.instanceColor.needsUpdate = true;
    return slot.handle;
  }

  // --- frame update ---------------------------------------------------------

  /** Advance all pooled effects. @param {number} dt seconds */
  update(dt) {
    this._t += dt;

    // engine trails: emit into the glow pool, spread along the frame's motion
    // segment so a fast or slow emitter never stacks a bloom-saturating clump.
    for (let i = this._trails.length - 1; i >= 0; i--) {
      const tr = this._trails[i];
      if (!tr.alive) { this._trails.splice(i, 1); continue; }
      if (tr.level <= 0.001) { tr.accum = 0; tr.hasLast = false; continue; }
      tr.obj.getWorldPosition(_V1);
      if (!tr.hasLast) { tr.last.copy(_V1); tr.hasLast = true; }
      tr.accum += (10 + 90 * tr.level) * dt;
      const n = Math.floor(tr.accum);
      tr.accum -= n;
      const bright = 1.0 + 1.6 * tr.level;
      for (let k = 0; k < n; k++) {
        const f = (k + 1) / n;
        const px = tr.last.x + (_V1.x - tr.last.x) * f;
        const py = tr.last.y + (_V1.y - tr.last.y) * f;
        const pz = tr.last.z + (_V1.z - tr.last.z) * f;
        this._glow.spawn(
          px + (Math.random() - 0.5) * 0.4,
          py + (Math.random() - 0.5) * 0.4,
          pz + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4,
          tr.color.r * bright, tr.color.g * bright, tr.color.b * bright, 0.55,
          0.8 + 1.3 * tr.level * Math.random(), 0.5 + Math.random() * 0.6,
          1.8, 0, 1.1
        );
      }
      tr.last.copy(_V1);
    }

    this._glow.update(dt);
    this._smoke.update(dt);

    // flash sprites
    for (const f of this._flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.spr.visible = false; f.mat.opacity = 0; continue; }
      const t = 1 - f.life / f.maxLife;
      const s = f.s0 + (f.s1 - f.s0) * Math.pow(t, 0.35);
      f.spr.scale.set(s, s, 1);
      f.mat.opacity = Math.pow(1 - t, 1.6);
    }

    // mining beams
    for (const b of this._beams) {
      if (!b.active) continue;
      b.coreMat.map.offset.y -= dt * 3.5;
      const pulse = 1 + 0.22 * Math.sin(this._t * 17 + b.phase);
      b.impact.scale.set(b.impactBase * pulse, b.impactBase * pulse, 1);
      b.glowMat.opacity = 0.3 + 0.08 * Math.sin(this._t * 11 + b.phase);
    }

    // warp tunnels
    for (let i = this._warps.length - 1; i >= 0; i--) {
      const w = this._warps[i];
      if (!w.alive) {
        this.scene.remove(w.lines);
        w.geo.dispose(); w.mat.dispose();
        this._warps.splice(i, 1);
        continue;
      }
      const on = w.level > 0.004;
      w.lines.visible = on;
      if (!on) continue;
      w.camera.getWorldPosition(w.lines.position);
      w.camera.getWorldQuaternion(w.lines.quaternion);
      w.mat.opacity = Math.min(1, w.level * 1.4);
      const speed = 40 + 280 * w.level;
      const len = 2 + 30 * w.level;
      const pos = w.geo.attributes.position.array;
      const L = w.line;
      for (let j = 0; j < WARP_LINES; j++) {
        let zh = L[j * 4 + 2] + speed * L[j * 4 + 3] * dt;
        if (zh - len > 26) zh = -170 - Math.random() * 40;
        L[j * 4 + 2] = zh;
        const x = L[j * 4], y = L[j * 4 + 1];
        pos[j * 6] = x; pos[j * 6 + 1] = y; pos[j * 6 + 2] = zh;
        pos[j * 6 + 3] = x; pos[j * 6 + 4] = y; pos[j * 6 + 5] = zh - len * L[j * 4 + 3];
      }
      w.geo.attributes.position.needsUpdate = true;
    }

    // laser bolts
    let anyBolt = false;
    for (let i = 0; i < BOLT_CAP; i++) {
      const s = this._bolts[i];
      if (!s.handle.alive) continue;
      s.life += dt;
      if (s.life > BOLT_MAX_LIFE) s.handle.alive = false;
      if (!s.handle.alive) {
        this._boltMesh.setMatrixAt(i, _M0);
        anyBolt = true;
        continue;
      }
      s.handle.position.addScaledVector(s.dir, s.speed * dt);
      _M1.compose(s.handle.position, s.quat, _ONE);
      this._boltMesh.setMatrixAt(i, _M1);
      anyBolt = true;
    }
    if (anyBolt) this._boltMesh.instanceMatrix.needsUpdate = true;
  }

  /** Tear down every pool, mesh, material and texture owned by the system. */
  dispose() {
    this._glow.dispose();
    this._smoke.dispose();
    for (const f of this._flashes) { f.spr.removeFromParent(); f.mat.dispose(); }
    for (const b of this._beams) {
      b.group.removeFromParent();
      b.coreMat.map.dispose(); b.coreMat.dispose(); b.glowMat.dispose(); b.impactMat.dispose();
    }
    for (const w of this._warps) { w.lines.removeFromParent(); w.geo.dispose(); w.mat.dispose(); }
    this._boltMesh.removeFromParent();
    this._boltMesh.geometry.dispose();
    this._boltMesh.dispose();
    this._boltMat.dispose();
    this._beamGeo.dispose();
    this._dotTex.dispose();
    this._flashTex.dispose();
    this._puffTex.dispose();
    this._stripeTex.dispose();
    this._trails.length = 0;
    this._beams.length = 0;
    this._warps.length = 0;
  }

  // --- internals --------------------------------------------------------------

  _flash(pos, s0, s1, life, color, hdr) {
    let f = null;
    for (const c of this._flashes) if (c.life <= 0) { f = c; break; }
    if (!f) f = this._flashes[0];
    f.life = f.maxLife = life;
    f.s0 = s0; f.s1 = s1;
    f.spr.position.copy(pos);
    f.spr.scale.set(s0, s0, 1);
    f.mat.color.setRGB(color.r * hdr, color.g * hdr, color.b * hdr);
    f.mat.opacity = 1;
    f.spr.visible = true;
  }

  _makeBeam() {
    const group = new THREE.Group();
    const stripe = this._stripeTex.clone();
    stripe.needsUpdate = true;
    const coreMat = new THREE.MeshBasicMaterial({
      map: stripe, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const core = new THREE.Mesh(this._beamGeo, coreMat);
    const glowMat = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending, transparent: true, opacity: 0.3,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const glow = new THREE.Mesh(this._beamGeo, glowMat);
    const impactMat = new THREE.SpriteMaterial({
      map: this._dotTex, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    });
    const impact = new THREE.Sprite(impactMat);
    group.add(core, glow, impact);
    group.visible = false;
    core.renderOrder = glow.renderOrder = impact.renderOrder = 10;
    this.scene.add(group);
    const beam = {
      group, core, glow, impact, coreMat, glowMat, impactMat,
      active: false, phase: 0, impactBase: 1,
    };
    this._beams.push(beam);
    return beam;
  }

  _setBeam(beam, from, to) {
    _V1.addVectors(from, to).multiplyScalar(0.5);
    _V2.subVectors(to, from);
    const len = Math.max(_V2.length(), 0.001);
    beam.group.position.copy(_V1);
    beam.group.quaternion.setFromUnitVectors(_Y, _V2.multiplyScalar(1 / len));
    beam.core.scale.set(0.09, len, 0.09);
    beam.glow.scale.set(0.32, len * 0.995, 0.32);
    beam.impact.position.set(0, len / 2, 0);
    beam.impactBase = 1.3;
    beam.coreMat.map.repeat.set(1, Math.max(1, len / 6));
  }
}

// module-scope scratch (no per-frame allocation)
const _V1 = new THREE.Vector3();
const _V2 = new THREE.Vector3();
const _C1 = new THREE.Color();
const _C2 = new THREE.Color();
const _M0 = new THREE.Matrix4().makeScale(0, 0, 0);
const _M1 = new THREE.Matrix4();
const _ONE = new THREE.Vector3(1, 1, 1);
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _WHITE = new THREE.Color(1, 1, 1);

function _rndDir(out) {
  const u = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(a), s * Math.sin(a), u);
}
