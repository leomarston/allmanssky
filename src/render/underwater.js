// UnderwaterSystem — the underwater experience layer for planet surfaces.
// While the camera is below field.seaY it swaps scene fog for a dense
// depth-graded water fog (reapplied every update AFTER the SkyDome has written
// its own fog — call update() after sky.update()), dims the view with a
// camera-attached translucent shell, and animates: rising bubbles (player
// stream + seeded seafloor vents), 2–4 seeded boids-lite fish schools,
// streamed instanced kelp beds on 3–25 m seafloor, and additive caustic
// patches + light shafts near the player. Everything is pooled / instanced
// (≤ 8 draw calls), steady-state allocation-free, and deterministic via
// field.cellRng. Constructs as a cheap no-op when the planet has no sea.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RNG, hash32, hashString } from '../core/rng.js';

const KELP_CELL = 64;     // m — matches TerrainField cell grid
const KELP_VIEW = 3;      // cells → ~200 m stream radius
const KELP_CAP = 1500;    // instances
const FISH_SLOTS = 4;     // max simultaneous schools
const FISH_PER = 24;      // max fish per school
const FISH_GRID = 96;     // m — school seeding grid
const FISH_RANGE = 120;   // m — spawn radius
const FISH_DROP = 140;    // m — despawn radius
const BUB_MAX = 224;      // pooled bubble particles
const VENT_MAX = 10;      // ambient seafloor bubble columns
const CAUSTIC_N = 7;      // dappled light patches
const SHAFT_N = 4;        // god-ray shafts
const UP = new THREE.Vector3(0, 1, 0);

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ----------------------------------------------------------------- textures

function makeBubbleTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.04)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.85, 'rgba(255,255,255,0.6)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath();
  g.arc(24, 22, 3, 0, Math.PI * 2);
  g.fill();
  return new THREE.CanvasTexture(c);
}

function makeCausticTexture(seed) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000000';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  const rng = new RNG(hash32(seed, 9101));
  // web of soft overlapping rings ≈ refracted-light cells; strokes are drawn
  // at ±S offsets so the texture tiles seamlessly
  for (let pass = 0; pass < 2; pass++) {
    const n = pass === 0 ? 24 : 18;
    g.lineWidth = pass === 0 ? 5 : 2;
    g.strokeStyle = pass === 0 ? 'rgba(130,205,255,0.20)' : 'rgba(215,242,255,0.55)';
    g.filter = pass === 0 ? 'blur(4px)' : 'blur(1px)';
    for (let i = 0; i < n; i++) {
      const x = rng.range(0, S), y = rng.range(0, S);
      const r = rng.range(14, 40), sq = rng.range(0.55, 1), rot = rng.range(0, Math.PI);
      for (let dy = -S; dy <= S; dy += S) {
        for (let dx = -S; dx <= S; dx += S) {
          g.beginPath();
          g.ellipse(x + dx, y + dy, r, r * sq, rot, 0, Math.PI * 2);
          g.stroke();
        }
      }
    }
  }
  g.filter = 'none';
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeShaftTexture() {
  const W = 64, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const v = g.createLinearGradient(0, 0, 0, H);
  v.addColorStop(0, 'rgba(255,255,255,0.8)');
  v.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  v.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-in';
  const h = g.createLinearGradient(0, 0, W, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.3, 'rgba(0,0,0,0.9)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(0.7, 'rgba(0,0,0,0.9)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = h;
  g.fillRect(0, 0, W, H);
  return new THREE.CanvasTexture(c);
}

// ---------------------------------------------------------------- geometries

function nonIndexed(geos) {
  const flat = geos.map((p) => (p.index ? p.toNonIndexed() : p));
  const merged = mergeGeometries(flat, false);
  for (const p of geos) p.dispose();
  for (const p of flat) { if (!geos.includes(p)) p.dispose(); }
  return merged;
}

/** Clump of crossed tapered ribbon stalks, unit height, vertex-color gradient. */
function buildKelpGeometry(cBase, cTip) {
  const SEGS = 6;
  const parts = [];
  const stalks = [ // x, z, height, phase
    [0, 0, 1, 0], [0.42, 0.2, 0.72, 2.1], [-0.3, -0.34, 0.55, 4.4],
  ];
  for (const [sx, sz, sh, sph] of stalks) {
    for (let k = 0; k < 2; k++) {
      const gpl = new THREE.PlaneGeometry(1, 1, 1, SEGS);
      gpl.translate(0, 0.5, 0);
      const p = gpl.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        p.setX(i, p.getX(i) * (0.85 - 0.66 * y));                // taper to the tip
        p.setZ(i, Math.sin(y * 4.2 + k * 1.8 + sph) * 0.09);     // gentle S-curve
      }
      gpl.rotateY(k * Math.PI * 0.5 + sph);
      gpl.scale(1, sh, 1);
      gpl.translate(sx, 0, sz);
      parts.push(gpl);
    }
  }
  const geo = nonIndexed(parts);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const t = clamp01(p.getY(i));
    c.copy(cBase).lerp(cTip, t);
    const band = 0.88 + 0.12 * Math.sin(t * 19);       // frond banding
    colors[i * 3] = c.r * band;
    colors[i * 3 + 1] = c.g * band;
    colors[i * 3 + 2] = c.b * band;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Tiny low-poly fish (~36 tris), nose at +X, grayscale back→belly gradient. */
function buildFishGeometry() {
  const body = new THREE.OctahedronGeometry(0.5, 1);
  body.scale(1.9, 0.55, 0.34);
  const tail = new THREE.PlaneGeometry(0.36, 0.34);
  tail.translate(-1.06, 0, 0);
  const fin = new THREE.PlaneGeometry(0.28, 0.2);
  fin.translate(0.08, 0.33, 0);
  const geo = nonIndexed([body, tail, fin]);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const gsh = 1.0 - 0.42 * clamp01((p.getY(i) + 0.28) / 0.56); // dark back, light belly
    colors[i * 3] = gsh; colors[i * 3 + 1] = gsh; colors[i * 3 + 2] = gsh;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Crossed vertical planes hanging from y=0 down to y=-1 (light shaft). */
function buildShaftGeometry() {
  const parts = [];
  for (let k = 0; k < 2; k++) {
    const p = new THREE.PlaneGeometry(1, 1, 1, 1);
    p.translate(0, -0.5, 0);
    p.rotateY(k * Math.PI * 0.5);
    parts.push(p);
  }
  return nonIndexed(parts);
}

// -------------------------------------------------------------------- system

/**
 * Underwater visuals + life for one planet surface.
 * Contract: constructor(scene, planetDef, field), update(dt, cameraPos,
 * playerPos), get submerged, dispose(). Call update() AFTER SkyDome.update()
 * each frame — the sky rewrites scene fog and this system must win while the
 * camera is submerged.
 */
export class UnderwaterSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} planetDef PlanetDef (palette, floraDensity, faunaDensity, seed)
   * @param {object} field TerrainField-compatible (seaY, height, moisture, cellRng)
   */
  constructor(scene, planetDef, field) {
    this.scene = scene;
    this.def = planetDef ?? {};
    this.field = field;
    this._submerged = false;
    this._active = !!field && Number.isFinite(field.seaY);
    if (!this._active) return; // no sea: stay a cheap no-op forever

    const seed = (this.def.seed ?? hashString(String(this.def.id ?? 'p'))) >>> 0;
    this._t = 0;
    this._uTime = { value: 0 };

    // palette
    const P = this.def.palette ?? {};
    this._deep = new THREE.Color(P.deepWater ?? '#0b3050');
    this._shallow = new THREE.Color(P.shallowWater ?? '#2e93a8');
    this._accent = new THREE.Color(P.accent ?? '#59b552');
    this._low = new THREE.Color(P.low ?? '#3f7f3a');
    this._fogShallow = this._shallow.clone().lerp(this._deep, 0.22).multiplyScalar(0.8);
    this._fogDeep = this._deep.clone().multiplyScalar(0.4);
    this._tintShallow = this._shallow.clone().lerp(this._deep, 0.55).multiplyScalar(0.55);
    this._tintDeep = this._deep.clone().multiplyScalar(0.32);

    // fog override bookkeeping (params cached fresh on every submerge)
    this._fogCache = { had: false, colorHex: 0, isExp2: true, density: 0, near: 0, far: 0 };
    this._ownFog = new THREE.FogExp2(0x0b3050, 0.06); // used when scene had no fog
    this._fogCol = new THREE.Color();

    // scratch (zero per-frame allocation)
    this._v = new THREE.Vector3();
    this._vs = new THREE.Vector3();
    this._n = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._eFish = new THREE.Euler(0, 0, 0, 'YZX');
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._c2 = new THREE.Color();
    this._hideM = new THREE.Matrix4().makeScale(0, 0, 0);

    this.group = new THREE.Group();
    this.group.name = 'underwater';
    scene.add(this.group);

    this._buildBackdrop();
    this._buildTint();
    this._buildKelp(seed);
    this._buildFish();
    this._buildBubbles();
    this._buildCaustics(seed);

    // streaming state
    this._kcx = Infinity; this._kcz = Infinity;
    this._kelpCells = new Map();
    this._scanT = 0;
    this._plAcc = 0;
    this._cauX = Infinity; this._cauZ = Infinity;
  }

  /** True while the camera is below the sea surface (false with no sea). */
  get submerged() { return this._submerged; }

  // ------------------------------------------------------------------ build

  _buildBackdrop() {
    // opaque fog-enabled shell well beyond the underwater sight range: it
    // saturates to exactly the fog color and walls off the (fog-immune)
    // SkyDome, so the horizon reads as water in every direction
    const geo = new THREE.SphereGeometry(130, 24, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0b3050, side: THREE.BackSide, depthWrite: false, fog: true,
    });
    this._backdrop = new THREE.Mesh(geo, mat);
    this._backdrop.renderOrder = -90; // right after the sky dome (-100)
    this._backdrop.frustumCulled = false;
    this._backdrop.visible = false;
    this.group.add(this._backdrop);
  }

  _buildTint() {
    const geo = new THREE.SphereGeometry(0.55, 18, 12);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x0a2a3a, transparent: true, opacity: 0.24,
      side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    this._tint = new THREE.Mesh(geo, mat);
    this._tint.renderOrder = 900;
    this._tint.frustumCulled = false;
    this._tint.visible = false;
    this.group.add(this._tint);
  }

  _buildKelp(seed) {
    const cBase = this._deep.clone().lerp(this._low, 0.45).multiplyScalar(0.6);
    const cTip = this._low.clone().lerp(this._accent, 0.3).lerp(this._shallow, 0.2);
    const geo = buildKelpGeometry(cBase, cTip);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
    });
    this._uKelpGlow = { value: 0.6 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this._uTime;
      shader.uniforms.uKelpGlow = this._uKelpGlow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          'vec3 kOri = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
          'float kPh = kOri.x * 0.37 + kOri.z * 0.53;',
          'float kW = position.y * position.y;', // sway grows toward the tip
          'float kB = sin(uTime * 0.8 + kPh) * 0.6 + sin(uTime * 1.9 + kPh * 1.7) * 0.25;',
          'transformed.x += kB * 0.3 * kW;',
          'transformed.z += (cos(uTime * 0.63 + kPh * 1.31) * 0.5 + sin(uTime * 1.4 + kPh) * 0.2) * 0.26 * kW;',
          '#endif',
        ].join('\n'));
      // soft self-light so strands never collapse to black silhouettes
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uKelpGlow;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * uKelpGlow;');
    };
    mat.customProgramCacheKey = () => 'ams-underwater-kelp';
    const mesh = new THREE.InstancedMesh(geo, mat, KELP_CAP);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, this._c.setRGB(1, 1, 1)); // allocate full color buffer
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = 'underwater:kelp';
    this._kelpMesh = mesh;
    this._kelpSeed = seed;
    this.group.add(mesh);
  }

  _buildFish() {
    const geo = buildFishGeometry();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 0.7, metalness: 0,
    });
    this._uFishGlow = { value: 0.15 };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this._uTime;
      shader.uniforms.uFishGlow = this._uFishGlow;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          'vec3 fOri = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
          'float fPh = fOri.x * 1.7 + fOri.z * 2.3;',
          // tail wiggle, strongest behind the body midpoint
          'transformed.z += sin(uTime * 7.0 + fPh + position.x * 2.5) * 0.13 * max(-position.x, 0.0);',
          '#endif',
        ].join('\n'));
      // per-school-tinted self-light (vColor carries the instance color);
      // ramps up in deep water for a bioluminescent read
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uFishGlow;')
        .replace('#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * uFishGlow;');
    };
    mat.customProgramCacheKey = () => 'ams-underwater-fish';
    const mesh = new THREE.InstancedMesh(geo, mat, FISH_SLOTS * FISH_PER);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FISH_SLOTS * FISH_PER; i++) {
      mesh.setMatrixAt(i, this._hideM);
      mesh.setColorAt(i, this._c.setRGB(1, 1, 1));
    }
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.name = 'underwater:fish';
    this._fishMesh = mesh;
    this._fishMat = mat;
    this.group.add(mesh);

    this._schools = [];
    for (let s = 0; s < FISH_SLOTS; s++) {
      this._schools.push({
        active: false, cx: 0, cz: 0, bx: 0, bz: 0, ph1: 0, ph2: 0, speed: 1, count: 0,
        r: new Float32Array(FISH_PER), w: new Float32Array(FISH_PER),
        ph: new Float32Array(FISH_PER), ox: new Float32Array(FISH_PER),
        oz: new Float32Array(FISH_PER), bobA: new Float32Array(FISH_PER),
        bobPh: new Float32Array(FISH_PER), size: new Float32Array(FISH_PER),
      });
    }
  }

  _buildBubbles() {
    const pos = new Float32Array(BUB_MAX * 3);
    for (let i = 0; i < BUB_MAX; i++) pos[i * 3 + 1] = -99999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    this._bubTex = makeBubbleTexture();
    const mat = new THREE.PointsMaterial({
      map: this._bubTex, size: 0.17, sizeAttenuation: true,
      color: new THREE.Color(0.75, 0.92, 1.0), transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    this._bubbles = new THREE.Points(geo, mat);
    this._bubbles.frustumCulled = false;
    this._bubbles.visible = false;
    this._bubbles.name = 'underwater:bubbles';
    this.group.add(this._bubbles);

    this._bubData = new Float32Array(BUB_MAX * 3); // speed, wobble amp, wobble phase
    this._bubLife = new Float32Array(BUB_MAX);
    this._bubFree = new Int16Array(BUB_MAX);
    for (let i = 0; i < BUB_MAX; i++) this._bubFree[i] = i;
    this._bubFreeCount = BUB_MAX;
    this._vents = new Float32Array(VENT_MAX * 5); // x, y, z, rate, phase
    this._ventAcc = new Float32Array(VENT_MAX);
    this._ventCount = 0;
  }

  _buildCaustics(seed) {
    // dappled light patches hugging the seafloor
    this._cauTex = makeCausticTexture(seed);
    this._cauTex.repeat.set(2, 2); // finer dapple across each patch
    const cGeo = new THREE.PlaneGeometry(1, 1);
    cGeo.rotateX(-Math.PI / 2);
    const cMat = new THREE.MeshBasicMaterial({
      map: this._cauTex, color: this._shallow.clone().lerp(new THREE.Color(1, 1, 1), 0.55),
      transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    // soft radial falloff so the additive patches have no hard quad edges
    cMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCauUv;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCauUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vCauUv;')
        .replace('#include <map_fragment>', [
          '#include <map_fragment>',
          'vec2 cE = vCauUv - 0.5;',
          'diffuseColor.rgb *= smoothstep(0.5, 0.22, length(cE));',
        ].join('\n'));
    };
    cMat.customProgramCacheKey = () => 'ams-underwater-caustic';
    this._cauMesh = new THREE.InstancedMesh(cGeo, cMat, CAUSTIC_N);
    this._cauMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < CAUSTIC_N; i++) this._cauMesh.setMatrixAt(i, this._hideM);
    this._cauMesh.frustumCulled = false;
    this._cauMesh.visible = false;
    this._cauMesh.name = 'underwater:caustics';
    this.group.add(this._cauMesh);
    // fixed scatter offsets around the player, snapped on reposition
    this._cauOff = new Float32Array([0, 0, 11, 5, -9, 8, 6, -11, -13, -5, 15, -2, -4, 14]);
    this._cauSize = new Float32Array([14, 11, 12, 9, 13, 10, 11]);

    // god-ray shafts from the surface
    this._shaftTex = makeShaftTexture();
    const sGeo = buildShaftGeometry();
    const sMat = new THREE.MeshBasicMaterial({
      map: this._shaftTex, color: this._shallow.clone().lerp(new THREE.Color(1, 1, 1), 0.4),
      transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    this._shaftMesh = new THREE.InstancedMesh(sGeo, sMat, SHAFT_N);
    this._shaftMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < SHAFT_N; i++) this._shaftMesh.setMatrixAt(i, this._hideM);
    this._shaftMesh.frustumCulled = false;
    this._shaftMesh.visible = false;
    this._shaftMesh.name = 'underwater:shafts';
    this.group.add(this._shaftMesh);
    this._shaftOff = new Float32Array([4, -9, -11, 3, 9, 8, -6, -14]);
    this._shaftData = new Float32Array(SHAFT_N * 4); // x, z, len, width
  }

  // -------------------------------------------------------------------- fog

  _cacheFog() {
    const f = this.scene.fog;
    const c = this._fogCache;
    if (f) {
      c.had = true;
      c.colorHex = f.color.getHex();
      c.isExp2 = f.isFogExp2 === true;
      if (c.isExp2) c.density = f.density;
      else { c.near = f.near; c.far = f.far; }
    } else {
      c.had = false;
      this.scene.fog = this._ownFog;
    }
  }

  _restoreFog() {
    const f = this.scene.fog;
    const c = this._fogCache;
    if (!c.had) {
      if (f === this._ownFog) this.scene.fog = null;
      return;
    }
    if (!f) return;
    f.color.setHex(c.colorHex);
    if (f.isFogExp2 && c.isExp2) f.density = c.density;
    else if (!f.isFogExp2 && !c.isExp2) { f.near = c.near; f.far = c.far; }
  }

  _applyFog(d01) {
    let f = this.scene.fog;
    if (!f) { f = this._ownFog; this.scene.fog = f; } // sky got disposed mid-dive
    const t = this._t;
    // slow color wobble ≈ light refracting through the surface
    const wob = 1 + 0.05 * Math.sin(t * 0.6) + 0.035 * Math.sin(t * 1.31 + 1.7);
    this._fogCol.copy(this._fogShallow).lerp(this._fogDeep, d01).multiplyScalar(wob);
    f.color.copy(this._fogCol);
    const density = (0.045 + 0.045 * d01) * (1 + 0.05 * Math.sin(t * 0.83 + 0.9));
    if (f.isFogExp2) f.density = density;
    else { f.near = 0.4; f.far = 3.2 / density; }
  }

  // ------------------------------------------------------------------- kelp

  _genKelpCell(cx, cz) {
    const rng = this.field.cellRng(cx, cz, 'kelp');
    const density = clamp01(this.def.floraDensity ?? 0.5);
    const seaY = this.field.seaY;
    // kelp grows in beds: most cells sparse, some are forests
    const bed = rng.chance(0.3 + 0.4 * density);
    const attempts = Math.round((bed ? 36 : 7) * density * rng.range(0.7, 1.3));
    const tmp = [];
    for (let i = 0; i < attempts; i++) {
      const x = (cx + rng.next()) * KELP_CELL, z = (cz + rng.next()) * KELP_CELL;
      const rotY = rng.range(0, Math.PI * 2);
      const shade = rng.range(0, 1);
      const hTry = rng.range(2.4, 6.4);
      const floor = this.field.height(x, z);
      const depth = seaY - floor;
      if (depth < 3 || depth > 25) continue;               // kelp band only
      if (this.field.moisture(x, z) < 0.3) continue;        // patchy beds
      const h = Math.min(depth - 0.7, hTry);                // never above the surface
      if (h < 1.3) continue;
      tmp.push(x, floor - 0.15, z, h, rotY, shade);
    }
    return new Float32Array(tmp);
  }

  _rebuildKelp() {
    const mesh = this._kelpMesh;
    let idx = 0;
    for (const arr of this._kelpCells.values()) {
      for (let o = 0; o < arr.length && idx < KELP_CAP; o += 6) {
        const sh = arr[o + 5];
        const w = 0.75 + sh * 0.5;
        this._e.set(0, arr[o + 4], 0);
        this._q.setFromEuler(this._e);
        this._m.compose(
          this._v.set(arr[o], arr[o + 1], arr[o + 2]),
          this._q,
          this._vs.set(w, arr[o + 3], w),
        );
        mesh.setMatrixAt(idx, this._m);
        mesh.setColorAt(idx, this._c.setRGB(0.72 + sh * 0.42, 0.78 + sh * 0.34, 0.74 + sh * 0.3));
        idx++;
      }
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  _updateKelp(p) {
    const cx = Math.floor(p.x / KELP_CELL), cz = Math.floor(p.z / KELP_CELL);
    if (cx === this._kcx && cz === this._kcz) return; // steady state: no work
    this._kcx = cx; this._kcz = cz;
    const want = new Set();
    for (let dz = -KELP_VIEW; dz <= KELP_VIEW; dz++) {
      for (let dx = -KELP_VIEW; dx <= KELP_VIEW; dx++) {
        const k = (cx + dx) + ':' + (cz + dz);
        want.add(k);
        if (!this._kelpCells.has(k)) this._kelpCells.set(k, this._genKelpCell(cx + dx, cz + dz));
      }
    }
    for (const k of this._kelpCells.keys()) if (!want.has(k)) this._kelpCells.delete(k);
    this._rebuildKelp();
    this._rebuildVents(cx, cz);
  }

  // ------------------------------------------------------------------- fish

  _deactivateSchool(s, si) {
    if (!s.active) return;
    s.active = false;
    const base = si * FISH_PER;
    for (let i = 0; i < FISH_PER; i++) this._fishMesh.setMatrixAt(base + i, this._hideM);
    this._fishMesh.instanceMatrix.needsUpdate = true;
  }

  _spawnSchool(s, si, cx, cz, x, z, rng) {
    s.active = true;
    s.cx = cx; s.cz = cz;
    s.bx = x; s.bz = z;
    s.ph1 = rng.range(0, Math.PI * 2);
    s.ph2 = rng.range(0, Math.PI * 2);
    s.speed = rng.range(0.7, 1.25);
    s.count = rng.int(12, FISH_PER);
    this._c.copy(this._accent).lerp(this._shallow, rng.range(0.05, 0.6));
    const base = si * FISH_PER;
    for (let i = 0; i < FISH_PER; i++) {
      s.r[i] = rng.range(0.6, 2.6);
      s.w[i] = rng.range(0.45, 1.1);
      s.ph[i] = rng.range(0, Math.PI * 2);
      s.ox[i] = rng.range(-1.6, 1.6);
      s.oz[i] = rng.range(-1.6, 1.6);
      s.bobA[i] = rng.range(0.25, 1.1);
      s.bobPh[i] = rng.range(0, Math.PI * 2);
      s.size[i] = rng.range(0.45, 0.85);
      this._c2.copy(this._c).offsetHSL(rng.range(-0.02, 0.02), rng.range(-0.06, 0.06), rng.range(-0.08, 0.12));
      this._fishMesh.setColorAt(base + i, this._c2);
    }
    if (this._fishMesh.instanceColor) this._fishMesh.instanceColor.needsUpdate = true;
  }

  _rescanSchools(p) {
    const seaY = this.field.seaY;
    // drop schools out of range
    for (let si = 0; si < FISH_SLOTS; si++) {
      const s = this._schools[si];
      if (!s.active) continue;
      const dx = s.bx - p.x, dz = s.bz - p.z;
      if (dx * dx + dz * dz > FISH_DROP * FISH_DROP) this._deactivateSchool(s, si);
    }
    const pcx = Math.floor(p.x / FISH_GRID), pcz = Math.floor(p.z / FISH_GRID);
    const density = clamp01(this.def.faunaDensity ?? 0.5);
    const chance = 0.35 + 0.45 * density;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        let taken = false, free = -1;
        for (let si = 0; si < FISH_SLOTS; si++) {
          const s = this._schools[si];
          if (s.active && s.cx === cx && s.cz === cz) { taken = true; break; }
          if (!s.active && free < 0) free = si;
        }
        if (taken || free < 0) continue;
        const rng = this.field.cellRng(cx, cz, 'fishschool');
        if (!rng.chance(chance)) continue;
        // find a water column deep enough for a school
        let sx = 0, sz = 0, found = false;
        for (let k = 0; k < 5 && !found; k++) {
          sx = (cx + rng.next()) * FISH_GRID;
          sz = (cz + rng.next()) * FISH_GRID;
          if (seaY - this.field.height(sx, sz) > 4.5) found = true;
        }
        if (!found) continue;
        const ddx = sx - p.x, ddz = sz - p.z;
        if (ddx * ddx + ddz * ddz > FISH_RANGE * FISH_RANGE) continue;
        this._spawnSchool(this._schools[free], free, cx, cz, sx, sz, rng);
      }
    }
  }

  _updateFish(dt, p, nearWater, d01) {
    if (!nearWater) {
      if (this._fishMesh.visible) {
        for (let si = 0; si < FISH_SLOTS; si++) this._deactivateSchool(this._schools[si], si);
        this._fishMesh.visible = false;
      }
      return;
    }
    this._scanT -= dt;
    if (this._scanT <= 0) { this._scanT = 0.8; this._rescanSchools(p); }

    const seaY = this.field.seaY;
    const t = this._t;
    let any = false;
    for (let si = 0; si < FISH_SLOTS; si++) {
      const s = this._schools[si];
      if (!s.active) continue;
      any = true;
      // drifting anchor between seafloor and surface
      const ax = s.bx + Math.sin(t * 0.073 + s.ph1) * 8 + Math.sin(t * 0.029 + s.ph2) * 4;
      const az = s.bz + Math.cos(t * 0.061 + s.ph2) * 8 + Math.sin(t * 0.041 + s.ph1) * 4;
      const floor = this.field.height(ax, az);
      const depth = seaY - floor;
      let ay = depth > 2.4
        ? floor + depth * (0.42 + 0.3 * Math.sin(t * 0.05 + s.ph1))
        : seaY - 1.2;
      if (ay > seaY - 1) ay = seaY - 1;
      if (ay < floor + 1) ay = floor + 1;
      const base = si * FISH_PER;
      for (let i = 0; i < s.count; i++) {
        const rr = s.r[i], w = s.w[i] * s.speed;
        const a = t * w + s.ph[i];
        const ca = Math.cos(a), sa = Math.sin(a);
        const px = ax + s.ox[i] + ca * rr * 1.35;
        const pz = az + s.oz[i] + sa * rr;
        let py = ay + Math.sin(t * 0.9 + s.bobPh[i]) * s.bobA[i];
        if (py > seaY - 0.45) py = seaY - 0.45;      // never above the surface
        if (py < floor + 0.6) py = floor + 0.6;
        const vx = -sa * rr * w * 1.35;
        const vz = ca * rr * w;
        const vy = Math.cos(t * 0.9 + s.bobPh[i]) * s.bobA[i] * 0.9;
        const sp = Math.sqrt(vx * vx + vz * vz) + 1e-5;
        this._eFish.set(0, Math.atan2(-vz, vx), Math.atan2(vy, sp) * 0.7);
        this._q.setFromEuler(this._eFish);
        this._m.compose(this._v.set(px, py, pz), this._q, this._vs.setScalar(s.size[i]));
        this._fishMesh.setMatrixAt(base + i, this._m);
      }
    }
    this._fishMesh.visible = any;
    if (any) {
      this._fishMesh.instanceMatrix.needsUpdate = true;
      // subtle bioluminescent lift in deep water
      this._uFishGlow.value = 0.15 + 0.45 * clamp01((d01 - 0.3) / 0.7);
    }
  }

  // ---------------------------------------------------------------- bubbles

  _spawnBubble(x, y, z) {
    if (this._bubFreeCount === 0) return;
    const i = this._bubFree[--this._bubFreeCount];
    const pa = this._bubbles.geometry.attributes.position.array;
    pa[i * 3] = x; pa[i * 3 + 1] = y; pa[i * 3 + 2] = z;
    // transient VFX jitter: Math.random is fine per architecture rules
    this._bubData[i * 3] = 0.45 + Math.random() * 0.75;
    this._bubData[i * 3 + 1] = 0.15 + Math.random() * 0.45;
    this._bubData[i * 3 + 2] = Math.random() * 6.2832;
    this._bubLife[i] = 4 + Math.random() * 4;
  }

  _rebuildVents(cx, cz) {
    const seaY = this.field.seaY;
    let n = 0;
    for (let dz = -2; dz <= 2 && n < VENT_MAX; dz++) {
      for (let dx = -2; dx <= 2 && n < VENT_MAX; dx++) {
        const rng = this.field.cellRng(cx + dx, cz + dz, 'bubblevent');
        if (!rng.chance(0.38)) continue;
        const x = (cx + dx + rng.next()) * KELP_CELL, z = (cz + dz + rng.next()) * KELP_CELL;
        const rate = rng.range(1.2, 3.4), ph = rng.range(0, Math.PI * 2);
        const floor = this.field.height(x, z);
        if (seaY - floor < 3) continue;
        const o = n * 5;
        this._vents[o] = x; this._vents[o + 1] = floor + 0.3; this._vents[o + 2] = z;
        this._vents[o + 3] = rate; this._vents[o + 4] = ph;
        this._ventAcc[n] = 0;
        n++;
      }
    }
    this._ventCount = n;
  }

  _updateBubbles(dt, camPos, p, nearWater) {
    const seaY = this.field.seaY;
    const t = this._t;
    if (nearWater) {
      // player stream while the player is submerged
      if (p.y < seaY - 0.25) {
        this._plAcc += dt * 14;
        while (this._plAcc >= 1) {
          this._plAcc -= 1;
          // ring around the body, below eye level, so none pops on the lens
          const a = Math.random() * 6.2832, rr = 0.55 + Math.random() * 0.6;
          this._spawnBubble(
            p.x + Math.cos(a) * rr,
            Math.min(p.y - 0.35 - Math.random() * 0.8, seaY - 0.3),
            p.z + Math.sin(a) * rr,
          );
        }
      } else this._plAcc = 0;
      // ambient seafloor vents, pulsing columns
      for (let vi = 0; vi < this._ventCount; vi++) {
        const o = vi * 5;
        const pulse = 0.5 + 0.5 * Math.sin(t * 0.45 + this._vents[o + 4]);
        this._ventAcc[vi] += dt * this._vents[o + 3] * (pulse > 0.6 ? 1 : 0.1);
        while (this._ventAcc[vi] >= 1) {
          this._ventAcc[vi] -= 1;
          this._spawnBubble(
            this._vents[o] + (Math.random() - 0.5) * 0.5,
            this._vents[o + 1],
            this._vents[o + 2] + (Math.random() - 0.5) * 0.5,
          );
        }
      }
    }
    // advance live particles
    const pa = this._bubbles.geometry.attributes.position.array;
    let alive = 0;
    for (let i = 0; i < BUB_MAX; i++) {
      let life = this._bubLife[i];
      if (life <= 0) continue;
      life -= dt;
      const o = i * 3;
      const y = pa[o + 1] + this._bubData[o] * dt;
      if (life <= 0 || y > seaY - 0.12) { // pop at the surface — never above it
        this._bubLife[i] = 0;
        pa[o + 1] = -99999;
        this._bubFree[this._bubFreeCount++] = i;
        continue;
      }
      const ph = this._bubData[o + 2], amp = this._bubData[o + 1];
      pa[o] += Math.sin(t * 2.1 + ph) * amp * dt;
      pa[o + 1] = y;
      pa[o + 2] += Math.cos(t * 1.7 + ph) * amp * 0.8 * dt;
      this._bubLife[i] = life;
      alive++;
    }
    this._bubbles.visible = alive > 0;
    if (alive > 0) this._bubbles.geometry.attributes.position.needsUpdate = true;
  }

  // ------------------------------------------------------- caustics + shafts

  _repositionCaustics(p) {
    const f = this.field, seaY = f.seaY;
    for (let i = 0; i < CAUSTIC_N; i++) {
      const gx = Math.round((p.x + this._cauOff[i * 2]) / 4) * 4;
      const gz = Math.round((p.z + this._cauOff[i * 2 + 1]) / 4) * 4;
      const hC = f.height(gx, gz);
      if (seaY - hC < 1.2) { this._cauMesh.setMatrixAt(i, this._hideM); continue; }
      // align the patch to the local seafloor slope
      const e = 2;
      this._n.set(-(f.height(gx + e, gz) - hC) / e, 1, -(f.height(gx, gz + e) - hC) / e).normalize();
      this._q.setFromUnitVectors(UP, this._n);
      this._e.set(0, i * 1.37, 0);
      this._q2.setFromEuler(this._e);
      this._q.multiply(this._q2);
      const s = this._cauSize[i];
      this._m.compose(this._v.set(gx, hC + 0.18, gz), this._q, this._vs.set(s, 1, s));
      this._cauMesh.setMatrixAt(i, this._m);
    }
    this._cauMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < SHAFT_N; i++) {
      const gx = Math.round((p.x + this._shaftOff[i * 2]) / 6) * 6;
      const gz = Math.round((p.z + this._shaftOff[i * 2 + 1]) / 6) * 6;
      const floor = f.height(gx, gz);
      const len = seaY - floor - 0.5;
      const o = i * 4;
      this._shaftData[o] = gx; this._shaftData[o + 1] = gz;
      this._shaftData[o + 2] = len > 2 ? len : 0;
      this._shaftData[o + 3] = 1.8 + (i % 3) * 0.8;
    }
  }

  _updateCaustics(dt, camPos, p, d01) {
    const sub = this._submerged;
    this._cauMesh.visible = sub;
    this._shaftMesh.visible = sub;
    if (!sub) return;
    const dx = p.x - this._cauX, dz = p.z - this._cauZ;
    if (dx * dx + dz * dz > 36) {
      this._cauX = p.x; this._cauZ = p.z;
      this._repositionCaustics(p);
    }
    const t = this._t;
    // scrolling dapple + depth fade (strong in the shallows, faint deep down)
    this._cauTex.offset.set(t * 0.017, t * 0.011);
    this._cauMesh.material.opacity = 0.09 + 0.2 * (1 - d01);
    this._shaftMesh.material.opacity = 0.1 + 0.16 * (1 - d01 * 0.6);
    for (let i = 0; i < SHAFT_N; i++) {
      const o = i * 4;
      const len = this._shaftData[o + 2];
      if (len <= 0) { this._shaftMesh.setMatrixAt(i, this._hideM); continue; }
      this._e.set(0.13, t * 0.05 + i * 1.7, 0.05);
      this._q.setFromEuler(this._e);
      const w = this._shaftData[o + 3] * (1 + 0.15 * Math.sin(t * 0.4 + i * 2.2));
      this._m.compose(
        this._v.set(this._shaftData[o], this.field.seaY - 0.1, this._shaftData[o + 1]),
        this._q, this._vs.set(w, len, w),
      );
      this._shaftMesh.setMatrixAt(i, this._m);
    }
    this._shaftMesh.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ update

  /**
   * Advance the underwater layer. Call AFTER SkyDome.update() so the fog
   * override wins while submerged.
   * @param {number} dt seconds
   * @param {THREE.Vector3} cameraPos camera world position (drives fog/tint)
   * @param {THREE.Vector3} [playerPos] player world position (bubbles, life);
   *   defaults to cameraPos
   */
  update(dt, cameraPos, playerPos) {
    if (!this._active || !cameraPos) return;
    const p = playerPos ?? cameraPos;
    this._t += dt;
    this._uTime.value = this._t;

    const seaY = this.field.seaY;
    const camDepth = seaY - cameraPos.y;
    const d01 = clamp01(camDepth / 22);
    const was = this._submerged;
    this._submerged = camDepth > 0;

    if (this._submerged && !was) this._cacheFog();       // fresh cache each dive
    else if (!this._submerged && was) this._restoreFog(); // exact surface fog back
    if (this._submerged) this._applyFog(d01);            // wins over SkyDome writes

    this._tint.visible = this._submerged;
    this._backdrop.visible = this._submerged;
    if (this._submerged) {
      this._tint.position.copy(cameraPos);
      this._tint.material.color.copy(this._tintShallow).lerp(this._tintDeep, d01);
      this._tint.material.opacity = 0.2 + 0.18 * d01;
      this._backdrop.position.copy(cameraPos);
      this._backdrop.material.color.copy(this._fogCol);
    }

    const nearWater = p.y < seaY + 25;
    this._updateKelp(p);
    this._updateBubbles(dt, cameraPos, p, nearWater);
    this._updateFish(dt, p, nearWater, d01);
    this._updateCaustics(dt, cameraPos, p, d01);
  }

  /** Remove everything from the scene and free all GPU resources. */
  dispose() {
    if (!this._active) return;
    if (this._submerged) { this._restoreFog(); this._submerged = false; }
    this.scene.remove(this.group);
    this._backdrop.geometry.dispose();
    this._backdrop.material.dispose();
    this._tint.geometry.dispose();
    this._tint.material.dispose();
    this._kelpMesh.geometry.dispose();
    this._kelpMesh.material.dispose();
    this._kelpMesh.dispose();
    this._fishMesh.geometry.dispose();
    this._fishMesh.material.dispose();
    this._fishMesh.dispose();
    this._bubbles.geometry.dispose();
    this._bubbles.material.dispose();
    this._bubTex.dispose();
    this._cauMesh.geometry.dispose();
    this._cauMesh.material.dispose();
    this._cauMesh.dispose();
    this._cauTex.dispose();
    this._shaftMesh.geometry.dispose();
    this._shaftMesh.material.dispose();
    this._shaftMesh.dispose();
    this._shaftTex.dispose();
    this._kelpCells.clear();
    this._active = false;
  }
}
