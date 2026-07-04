// GroundCover — the lush carpet. ONE InstancedMesh of multi-blade grass tufts
// scattered on the heightfield in a ring around the focus, streamed per 32 m
// cell (never per frame). Blades bend under a world-space, height-weighted wind
// field (two-octave gust + per-tuft flutter) and shrink smoothly into the ground
// before the fog wall so nothing pops. Lit by the scene's directional/hemisphere
// rig, tinted per instance toward the biome/terrain palette, and given a warm
// golden-hour back-translucency when you look toward the sun (feeds bloom).
//
// Deterministic: placement RNG comes from field.cellRng(cx, cz, 'groundcover');
// tuft shape + wind direction derive from the planet seed. No external art.
// SwiftShader-safe: standard MeshStandardMaterial + a tiny onBeforeCompile that
// injects only ALU (sin/dot/smoothstep) — no vertex texture fetch, no loops, no
// alpha test, one draw call.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';

const CELL = 24;              // metres — placement cell (finer → denser near field)
const RING_RADIUS = 58;       // metres — ground-cover ring (tight → dense carpet)
const FADE_BAND = 22;         // metres — distance over which blades shrink out
const ALTITUDE_CUTOFF = 60;   // hide the carpet when the focus is this far AGL
const INSTANCE_CAP = 90000;   // hard cap (one draw call, DynamicDrawUsage)
const SLOPE_MIN = 0.78;       // reject placement where terrain normal.y < this
const BLADES = 9;             // blades per tuft (bushy clump reads as coverage)
const SEG = 3;                // vertical segments per blade (smooth bend)
const TUFT_RADIUS = 0.24;     // object-space tuft spread (before instance scale)

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function col(hex) { return new THREE.Color(hex); }
function mix(a, b, t) { return a.clone().lerp(b, t); }

const PALETTE_FALLBACK = {
  shore: '#c9b98c', low: '#3f7f3a', mid: '#7a9a4f', high: '#cfd8cc',
  cliff: '#6b6257', accent: '#59b552', glow: '#7de8ff',
};

/** Parse def.palette into THREE.Colors with sane fallbacks. */
function paletteKit(def) {
  const kit = {};
  for (const k of Object.keys(PALETTE_FALLBACK)) kit[k] = col(def?.palette?.[k] ?? PALETTE_FALLBACK[k]);
  return kit;
}

// Warm chlorophyll glow reused across profiles for the sun back-translucency.
const SAP = new THREE.Color(0.95, 1.0, 0.55);

/**
 * Per-biome ground-cover recipe, or null for biomes that grow no soft carpet
 * (volcanic, crystal). perCell is the tuft target for one 32 m cell at density
 * 1 / moisture 1; width/height scale the object-space tuft into metres.
 * @returns {{perCell:number, width:number, height:number, cA:THREE.Color,
 *            cB:THREE.Color, tint:THREE.Color} | null}
 */
function grassProfile(biome, kit) {
  const green = mix(kit.low, kit.accent, 0.55);        // saturated blade green
  const deep = mix(kit.low, kit.mid, 0.4);             // darker olive (variety/roots)
  const dry = mix(kit.shore, kit.low, 0.5);            // arid biomes only
  const P = (perCell, width, height, cA, cB, tint) => ({
    perCell, width, height, cA, cB,
    tint: (tint ?? mix(cB, SAP, 0.55)).clone().multiplyScalar(0.5),
  });
  switch (biome) {
    case 'lush':       return P(3400, 0.95, 0.40, green, deep, mix(kit.accent, green, 0.5));
    case 'swamp':      return P(460, 1.00, 0.50, mix(kit.low, green, 0.6), deep);
    case 'ocean':      return P(360, 0.90, 0.40, mix(green, kit.shore, 0.25), deep);
    case 'toxic':      return P(150, 1.00, 0.60, mix(kit.low, kit.glow, 0.35), mix(kit.accent, kit.glow, 0.4), mix(kit.glow, SAP, 0.4));
    case 'irradiated': return P(118, 0.92, 0.50, mix(kit.low, kit.mid, 0.5), mix(kit.accent, kit.glow, 0.3), mix(kit.glow, SAP, 0.5));
    case 'exotic':     return P(100, 1.00, 0.60, mix(kit.low, kit.accent, 0.5), mix(kit.accent, kit.high, 0.4), mix(kit.glow, SAP, 0.5));
    case 'desert':     return P(72, 0.86, 0.40, mix(kit.shore, kit.low, 0.5), mix(kit.shore, kit.high, 0.3), mix(kit.shore, SAP, 0.25));
    case 'frozen':     return P(60, 0.82, 0.38, mix(kit.high, kit.mid, 0.4), kit.high.clone(), mix(kit.high, SAP, 0.15));
    case 'barren':     return P(34, 0.80, 0.34, mix(kit.cliff, kit.shore, 0.5), mix(kit.shore, kit.high, 0.4), mix(kit.shore, SAP, 0.2));
    default:           return null; // volcanic / crystal — no ground cover
  }
}

/**
 * Build ONE merged tuft geometry: BLADES tapered strips fanned around the origin,
 * each SEG segments tall and gently curved outward. Height is normalised to ~1 in
 * object space (per-instance Y-scale sets the real height); the wind shader reads
 * position.y directly as the bend weight. Grayscale root→tip gradient in the
 * color attribute is multiplied by the per-instance tint at draw time.
 */
function buildTuft(rng) {
  const vPer = (SEG + 1) * 2;
  const vcount = vPer * BLADES;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const clr = new Float32Array(vcount * 3);
  const idx = [];
  let vo = 0;
  for (let b = 0; b < BLADES; b++) {
    const ang = (b / BLADES) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rad = TUFT_RADIUS * rng.range(0.1, 1.0);
    const bx = ca * rad, bz = sa * rad;         // blade base offset from tuft centre
    const nx = ca, nz = sa;                     // outward (radial) direction in XZ
    const tx = -sa, tz = ca;                    // tangent = blade width axis in XZ
    const w0 = rng.range(0.04, 0.072);         // base width (metres, at scale 1)
    const hh = rng.range(0.82, 1.06);           // blade height (object space)
    const lean = rng.range(0.05, 0.22);         // outward curl toward the tip
    const bright = rng.range(0.85, 1.08);       // per-blade value jitter
    const start = vo;
    for (let r = 0; r <= SEG; r++) {
      const t = r / SEG;
      const y = t * hh;
      const halfW = Math.max(0.004, w0 * 0.5 * (1 - t * 0.85));   // taper to a point
      const curve = lean * t * t;
      const cX = bx + nx * curve, cZ = bz + nz * curve;
      // vertex normal: keep it closer to the blade's own outward tilt so blades
      // don't all point straight up and soak the blue sky hemisphere light
      const nyB = 0.85, inv = 1 / Math.hypot(nx, nyB, nz);
      const g = (0.42 + 0.5 * t) * bright;
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        pos[vo * 3] = cX + tx * halfW * sign;
        pos[vo * 3 + 1] = y;
        pos[vo * 3 + 2] = cZ + tz * halfW * sign;
        nor[vo * 3] = nx * inv; nor[vo * 3 + 1] = nyB * inv; nor[vo * 3 + 2] = nz * inv;
        clr[vo * 3] = g; clr[vo * 3 + 1] = g; clr[vo * 3 + 2] = g;
        vo++;
      }
    }
    for (let r = 0; r < SEG; r++) {
      const a = start + r * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(clr, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Lit grass material: MeshStandardMaterial (so scene lights + FogExp2 are honored
 * for free) with an onBeforeCompile that adds world-space wind, distance fade and
 * a sun back-translucency. All injected code is branch-light ALU → SwiftShader-safe.
 */
function makeGrassMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform float uTime;',
        'uniform vec2 uWindDir;',
        'uniform vec2 uWindPerp;',
        'uniform float uWindStrength;',
        'uniform float uFadeStart;',
        'uniform float uFadeEnd;',
        'varying vec3 vWorldPos;',
        'varying float vH;',
      ].join('\n'))
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '{',
        '  vec3 iOri = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
        '  float hw = clamp(position.y, 0.0, 1.0); hw *= hw;',   // stiff base, loose tip
        '  float g1 = sin(dot(iOri.xz, uWindDir) * 0.045 + uTime * 0.9);',
        '  float g2 = sin(dot(iOri.xz, uWindPerp) * 0.11 - uTime * 1.5 + g1 * 0.8);',
        '  float gust = g1 * 0.6 + g2 * 0.4;',                   // coherent, moving
        '  float ph = fract(sin(dot(iOri.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;',
        '  float flutter = sin(uTime * 2.7 + ph) * 0.5;',
        '  float amp = (0.55 + 0.45 * gust) * uWindStrength;',   // always downwind, gusting
        '  vec2 push = uWindDir * (hw * amp) + uWindPerp * (hw * flutter * uWindStrength * 0.35);',
        '  transformed.x += push.x; transformed.z += push.y;',
        '  float dCam = distance(cameraPosition, iOri);',
        '  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dCam);',
        '  transformed *= fade;',                                // shrink into the ground
        '  vH = hw;',
        '  vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
        '}',
        '#else',
        '  vH = clamp(position.y, 0.0, 1.0);',
        '  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        '#endif',
      ].join('\n'));
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform vec3 uSunDir;',
        'uniform vec3 uGrassTint;',
        'varying vec3 vWorldPos;',
        'varying float vH;',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        // golden-hour transmission: blade tips glow warm when you face the sun
        'vec3 amsV = normalize(cameraPosition - vWorldPos);',
        'float amsT = pow(max(dot(-amsV, normalize(uSunDir)), 0.0), 2.0);',
        'float amsDay = clamp(uSunDir.y * 2.0, 0.0, 1.0);',
        'totalEmissiveRadiance += uGrassTint * (amsT * amsDay * vH * 0.5);',
        // green self-lift: vertical blades get almost no overhead sun and would
        // otherwise soak the blue sky fill — push their own green so they read
        // as sunlit grass, weighted up the blade (roots stay grounded/dark)
        'totalEmissiveRadiance += diffuseColor.rgb * (0.55 * vH + 0.12);',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => 'ams-groundcover-v1';
  return mat;
}

/**
 * Instanced, streamed grass carpet for one planet surface.
 * Owns its InstancedMesh; call update(dt, focusPos, sunDir) each frame and
 * dispose() when leaving the surface.
 */
export class GroundCover {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../universe/terrainfield.js').TerrainField} field
   * @param {object} def PlanetDef (biome, palette, floraDensity, seed, terrain…)
   * @param {object} [opts] { density=1, cap=10000, radius=132, windStrength }
   */
  constructor(scene, field, def, opts = {}) {
    this.scene = scene;
    this.field = field;
    this.def = def;
    this.time = 0;
    this.cells = new Map();          // 'cx:cz' -> [placement]
    this._focusCell = null;
    this.enabled = false;

    this.density = Math.max(0, opts.density ?? 1);
    this.cap = Math.min(opts.cap ?? INSTANCE_CAP, INSTANCE_CAP);
    this.radius = opts.radius ?? RING_RADIUS;
    this._radius2 = this.radius * this.radius;

    this.profile = grassProfile(def?.biome ?? 'barren', paletteKit(def));
    if (!this.profile || (def?.floraDensity ?? 0) <= 0.001 || this.density <= 0) return;

    // snow line + waterline mirror TerrainRenderer so grass respects the same
    // bands (nothing above the snow caps, nothing in the shallows).
    const seaY = field.seaY;
    const relief = clamp01(def?.terrain?.relief ?? 0.5);
    const bandScale = 0.45 + 0.75 * relief;
    this._baseY = Number.isFinite(seaY) ? seaY : -field.contAmp * 0.45;
    this._snowY = def?.biome === 'frozen' ? this._baseY + 1.5 : this._baseY + 68 * bandScale;

    const seed = (def?.seed ?? hashString(String(def?.id ?? 'p'))) >>> 0;
    const wr = new RNG(hash32(seed, hashString('groundcover-wind')));
    const wa = wr.range(0, Math.PI * 2);

    this.uniforms = {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector2(Math.cos(wa), Math.sin(wa)) },
      uWindPerp: { value: new THREE.Vector2(-Math.sin(wa), Math.cos(wa)) },
      uWindStrength: { value: opts.windStrength ?? 0.11 },
      uFadeStart: { value: this.radius - FADE_BAND },
      uFadeEnd: { value: this.radius },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.5).normalize() },
      uGrassTint: { value: this.profile.tint.clone() },
    };

    this.geo = buildTuft(new RNG(hash32(seed, hashString('groundcover-tuft'))));
    this.material = makeGrassMaterial(this.uniforms);
    this.mesh = new THREE.InstancedMesh(this.geo, this.material, this.cap);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;     // streamed around focus; bounds are local
    this.mesh.castShadow = false;        // perf: blades never cast
    this.mesh.receiveShadow = false;
    this.mesh.name = 'groundcover';
    scene.add(this.mesh);
    this.enabled = true;

    // scratch (no per-frame allocation)
    this._m4 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._vs = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  /**
   * Advance wind, follow the focus and (only on cell crossing) re-scatter.
   * @param {number} dt seconds
   * @param {THREE.Vector3} focusPos player/camera world position
   * @param {THREE.Vector3} [sunDir] unit vector toward the sun (SkyDome.sunDir)
   */
  update(dt, focusPos, sunDir) {
    this.time += dt;
    if (!this.enabled) return;
    this.uniforms.uTime.value = this.time;
    if (sunDir) this.uniforms.uSunDir.value.copy(sunDir);
    if (!focusPos) return;

    // no grass from the air: skip the whole scatter while flying high
    const groundY = this.field.height(focusPos.x, focusPos.z);
    if (focusPos.y - groundY > ALTITUDE_CUTOFF) {
      if (this.mesh.count !== 0) this.mesh.count = 0;
      this._focusCell = null;               // force a rebuild once we descend
      return;
    }

    const cx = Math.floor(focusPos.x / CELL), cz = Math.floor(focusPos.z / CELL);
    const key = cx + ':' + cz;
    if (key === this._focusCell) return;    // still inside the same cell → nothing
    this._focusCell = key;
    this._stream(cx, cz);
    this._refill(focusPos);
  }

  /** Ensure every cell whose centre falls in the ring is generated + cached. */
  _stream(cx, cz) {
    const rc = Math.ceil(this.radius / CELL) + 1;
    const rCell = this.radius / CELL + 1, rCell2 = rCell * rCell;
    const want = new Set();
    for (let dx = -rc; dx <= rc; dx++) {
      for (let dz = -rc; dz <= rc; dz++) {
        if (dx * dx + dz * dz > rCell2) continue;
        const k = (cx + dx) + ':' + (cz + dz);
        want.add(k);
        if (!this.cells.has(k)) this.cells.set(k, this._genCell(cx + dx, cz + dz));
      }
    }
    for (const k of this.cells.keys()) if (!want.has(k)) this.cells.delete(k);
  }

  /** Deterministic tuft placements for one 32 m cell (allocation-free slope test). */
  _genCell(cx, cz) {
    const out = [];
    const p = this.profile;
    const field = this.field, seaY = field.seaY;
    const rng = field.cellRng(cx, cz, 'groundcover');
    const mC = clamp01(field.moisture((cx + 0.5) * CELL, (cz + 0.5) * CELL));
    const target = Math.round(p.perCell * this.density * (0.35 + 0.85 * mC) * rng.range(0.75, 1.1));
    for (let i = 0; i < target; i++) {
      const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
      const y = field.height(x, z);
      if (Number.isFinite(seaY) && y < seaY + 0.5) continue;   // underwater / shallows
      if (y > this._snowY - 1.5) continue;                      // above the snow line
      // slope via central differences (no Vector3 allocation)
      const e = 1.2;
      const hL = field.height(x - e, z), hR = field.height(x + e, z);
      const hD = field.height(x, z - e), hU = field.height(x, z + e);
      const ny = (2 * e) / Math.sqrt((hL - hR) * (hL - hR) + (2 * e) * (2 * e) + (hD - hU) * (hD - hU));
      if (ny < SLOPE_MIN) continue;
      const sxz = p.width * rng.range(0.8, 1.35);
      const sy = p.height * rng.range(0.75, 1.25);
      const tx = rng.range(-0.12, 0.12), tz = rng.range(-0.12, 0.12);   // small lean only, no heading spin
      const t = clamp01((1 - mC) * 0.55 + rng.range(0, 1) * 0.3);
      const c = p.cA.clone().lerp(p.cB, t).multiplyScalar(rng.range(0.5, 0.72));
      out.push({ x, y, z, sxz, sy, tx, tz, r: c.r, g: c.g, b: c.b });
    }
    return out;
  }

  /**
   * Write cached placements within the ring into the instance buffer, nearest
   * cells first — so if the hard cap is ever hit, the tufts dropped are the
   * farthest (already faded out), never ones near the player.
   */
  _refill(focusPos) {
    const m4 = this._m4, q = this._q, e = this._e, v = this._v, vs = this._vs, c = this._c;
    // order ~100 cells by centre distance (cheap; only runs on a cell crossing)
    const order = [];
    for (const [k, list] of this.cells) {
      const ci = k.indexOf(':');
      const ccx = (parseInt(k.slice(0, ci), 10) + 0.5) * CELL - focusPos.x;
      const ccz = (parseInt(k.slice(ci + 1), 10) + 0.5) * CELL - focusPos.z;
      order.push([ccx * ccx + ccz * ccz, list]);
    }
    order.sort((a, b) => a[0] - b[0]);
    let idx = 0;
    for (let o = 0; o < order.length && idx < this.cap; o++) {
      const list = order[o][1];
      for (let i = 0; i < list.length; i++) {
        if (idx >= this.cap) break;
        const p = list[i];
        const dx = p.x - focusPos.x, dz = p.z - focusPos.z;
        if (dx * dx + dz * dz > this._radius2) continue;
        e.set(p.tx, 0, p.tz);
        q.setFromEuler(e);
        m4.compose(v.set(p.x, p.y, p.z), q, vs.set(p.sxz, p.sy, p.sxz));
        this.mesh.setMatrixAt(idx, m4);
        this.mesh.setColorAt(idx, c.setRGB(p.r, p.g, p.b));
        idx++;
      }
    }
    this.mesh.count = idx;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Remove the mesh from the scene and free every GPU resource this owns. */
  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.dispose();
    }
    this.geo?.dispose();
    this.material?.dispose();
    this.cells.clear();
    this.enabled = false;
  }
}
