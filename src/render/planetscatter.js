// PlanetScatter — instanced, streamed ground cover for the SEAMLESS round planet.
//
// Scatters wind-animated grass tufts plus a few plant/rock archetypes in a ring
// around the player's ground point, sitting exactly ON the sphere so walking the
// round world reads as a living place rather than a bare ball. Self-contained,
// zero external art, SwiftShader-safe (plain MeshStandardMaterial + a tiny
// onBeforeCompile that injects only ALU — no VTF, no loops, no alpha test).
//
// FLOATING-ORIGIN FRAME (the crux)
//   PlanetSphere renders camera-relative: its root group sits at
//   (planetCenter - playerUniPos) while chunk vertices are ABSOLUTE planet-local
//   positions (dir * heightAt(dir)). We mirror that exactly: our InstancedMeshes
//   live inside one Group whose position we set to (planetCenter - playerUniPos)
//   every frame, and every instance matrix stores an ABSOLUTE planet-local pose
//   (position = dir_i * heightAt(dir_i)). Instance world pos therefore equals
//   dir_i*heightAt(dir_i) - playerUniPos — the identical frame the terrain uses,
//   so cover sits glued to the visible ground and slides with the world as you
//   walk, WITHOUT rewriting any instance matrix per frame. Matrices are rebuilt
//   only when the player crosses a scatter cell.
//
// ORIENTATION
//   Each instance's local +Y is aligned to its own radial direction dir_i (the
//   sphere normal at that point) with a random yaw about it, so blades/plants
//   stand up out of the curved ground, not tangent-flat or leaning toward a
//   single global up.
//
// PLACEMENT / STREAMING
//   Cells live on a cube-face UV grid (same parameterisation family as the
//   planet itself), so placement is deterministic and stable. The player's
//   dominant cube face + (u,v) cell is tracked; on a cell change we regenerate a
//   square neighbourhood of cells around it, deterministic per (seed, face, i, j).
//   Candidates below sea level, above the snow line, or on steep slopes (local
//   heightAt gradient) are rejected. A metric ring cull trims the square to a
//   disc. Instances distance-fade (shrink to nothing) before the ring edge so
//   nothing pops. Hard per-mesh instance caps; three draw calls total.

import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';

// --- tunables ---------------------------------------------------------------
const RING = 54;            // metres — cover ring radius around the player
const FADE_BAND = 16;       // metres — distance over which instances shrink out
const CELL_M = 18;          // metres — scatter cell size (near face centre)
const AGL_CUTOFF = 95;      // metres — skip scatter entirely above this AGL
const SLOPE_MIN_SOFT = 0.72;// reject grass/plants where local normal.y < this
const SLOPE_MIN_ROCK = 0.48;// rocks tolerate steeper ground
const GRASS_MIN_ALT = 1.5;  // metres above sea — keep cover off the beach/shallows
const SNOW_MARGIN = 0.90;   // grass stays below SNOW_MARGIN * snow line

const GRASS_CAP = 9000;     // hard instance caps (one draw call each)
const PLANT_CAP = 1400;
const ROCK_CAP = 1400;

const PER_CELL_GRASS = 40;  // candidates per cell (pre-rejection)
const PER_CELL_PLANT = 3;
const PER_CELL_ROCK = 3;

// --- palette ----------------------------------------------------------------
function col(hex) { return new THREE.Color(hex); }
const GRASS_LOW = col(0x5f9d3c);   // matches PlanetSphere grass band
const GRASS_HI = col(0x93a84a);    // drier olive higher up
const PLANT_LOW = col(0x4f8a38);
const PLANT_HI = col(0x86933f);
const ROCK_LOW = col(0x7c6e58);    // matches PlanetSphere rock band
const ROCK_HI = col(0xa9a394);     // paler / snow-dusted near the caps

// --- geometry helpers -------------------------------------------------------

/** Bake a bottom->top grayscale/color gradient into a geometry (Y in object space). */
function paintGradient(geo, cBot, cTop) {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, span = Math.max(bb.max.y - bb.min.y, 1e-5);
  const p = geo.attributes.position, n = p.count;
  const arr = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - bb.min.y) / span, 0, 1);
    c.copy(cBot).lerp(cTop, t);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Lift a geometry so its base sits at y=0 (object up = radial after instancing). */
function baseToFloor(geo) {
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox.min.y, 0);
  return geo;
}

/**
 * One merged multi-blade grass tuft: BLADES fanned tapered strips, SEG tall,
 * curved gently outward, height normalised to ~1 (per-instance Y-scale sets the
 * real height). Grayscale root->tip gradient in the color attribute is
 * multiplied by the per-instance tint at draw time; the wind shader reads
 * position.y as the bend weight.
 */
function buildTuft(rng) {
  const BLADES = 7, SEG = 2, TUFT_R = 0.22;
  const vPer = (SEG + 1) * 2, vcount = vPer * BLADES;
  const pos = new Float32Array(vcount * 3);
  const nor = new Float32Array(vcount * 3);
  const clr = new Float32Array(vcount * 3);
  const idx = [];
  let vo = 0;
  for (let b = 0; b < BLADES; b++) {
    const ang = (b / BLADES) * Math.PI * 2 + rng.range(-0.5, 0.5);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const rad = TUFT_R * rng.range(0.1, 1.0);
    const bx = ca * rad, bz = sa * rad;
    const nx = ca, nz = sa;      // outward (radial in XZ)
    const tx = -sa, tz = ca;     // blade width axis in XZ
    const w0 = rng.range(0.03, 0.062);
    const hh = rng.range(0.80, 1.05);
    const lean = rng.range(0.05, 0.22);
    const bright = rng.range(0.82, 1.06);
    const start = vo;
    for (let r = 0; r <= SEG; r++) {
      const t = r / SEG;
      const y = t * hh;
      const halfW = Math.max(0.004, w0 * 0.5 * (1 - t * 0.85));
      const curve = lean * t * t;
      const cX = bx + nx * curve, cZ = bz + nz * curve;
      const nyB = 0.8, inv = 1 / Math.hypot(nx, nyB, nz);
      const g = (0.62 + 0.40 * t) * bright;
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

/** A small leafy shrub: a squashed, jittered icosahedron. Base at y=0. */
function buildPlant(rng) {
  const g = new THREE.IcosahedronGeometry(0.5, 1);
  g.scale(1.0, 1.5, 1.0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + rng.range(-0.07, 0.07),
      p.getY(i) + rng.range(-0.07, 0.07),
      p.getZ(i) + rng.range(-0.07, 0.07));
  }
  g.computeVertexNormals();
  baseToFloor(g);
  return paintGradient(g, PLANT_LOW, PLANT_HI);
}

/** A low boulder: a flattened, jittered icosahedron. Base at y=0. */
function buildRock(rng) {
  const g = new THREE.IcosahedronGeometry(0.5, 0);
  g.scale(1.25, 0.72, 1.15);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i,
      p.getX(i) + rng.range(-0.06, 0.06),
      p.getY(i) + rng.range(-0.04, 0.04),
      p.getZ(i) + rng.range(-0.06, 0.06));
  }
  g.computeVertexNormals();
  baseToFloor(g);
  return paintGradient(g, ROCK_LOW, ROCK_HI);
}

// --- material ---------------------------------------------------------------

/**
 * Shared cover material factory. Standard PBR (scene lights + any fog honoured
 * for free) plus an onBeforeCompile that injects, all as branch-light ALU:
 *   - object-space wind sway (weight up the blade; tangent after instancing),
 *   - a planet-local distance fade that shrinks instances out before the ring,
 *   - a self-lift + sun back-translucency so thin blades read as sunlit.
 * All variants share the SAME uniforms object → one update site per frame.
 */
function makeCoverMat(uniforms, opt) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, side: opt.side ?? THREE.FrontSide,
    roughness: opt.roughness ?? 0.9, metalness: 0.0,
  });
  const wind = (opt.wind ?? 0).toFixed(3);
  const lift = (opt.lift ?? 0).toFixed(3);
  const skyFill = (opt.skyFill ?? 0).toFixed(3);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform float uTime;',
        'uniform float uWindStrength;',
        'uniform vec3 uFocus;',
        'uniform float uFadeStart;',
        'uniform float uFadeEnd;',
        'varying float vH;',
        'varying vec3 vWorldPos;',
      ].join('\n'))
      .replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        '#ifdef USE_INSTANCING',
        '{',
        '  vec3 iOri = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
        '  float hw = clamp(position.y, 0.0, 1.0); hw *= hw;', // stiff root, loose tip
        `  float wnd = ${wind};`,
        '  float sw = sin(uTime * 1.7 + iOri.x * 0.35 + iOri.z * 0.27);',
        '  float sw2 = sin(uTime * 1.15 + iOri.y * 0.5 + iOri.x * 0.13);',
        '  transformed.x += sw * hw * uWindStrength * wnd;',       // object x -> tangent
        '  transformed.z += sw2 * hw * uWindStrength * wnd * 0.6;',// object z -> tangent
        '  float dCam = distance(iOri, uFocus);',                 // planet-local distance
        '  float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, dCam);',
        '  transformed *= fade;',                                 // shrink into the ground
        '  vH = clamp(position.y, 0.0, 1.0);',
        '  vWorldPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;',
        '}',
        '#else',
        '  vH = clamp(position.y, 0.0, 1.0);',
        '  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        '#endif',
      ].join('\n'));
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'uniform vec3 uSunDir;',
        'varying float vH;',
        'varying vec3 vWorldPos;',
      ].join('\n'))
      .replace('#include <emissivemap_fragment>', [
        '#include <emissivemap_fragment>',
        `float amsLift = ${lift};`,
        // view-independent sky-fill so shadowed cover/rocks don't collapse to
        // near-black. FILL, not glow — kept well under the bloom threshold.
        `totalEmissiveRadiance += diffuseColor.rgb * ${skyFill};`,
        // self-lift: thin vertical cover soaks the blue sky fill and would read
        // dark — push its own colour up the blade so it looks sunlit.
        'totalEmissiveRadiance += diffuseColor.rgb * (amsLift * vH + amsLift * 0.22);',
        // golden-hour transmission toward the sun (feeds bloom gently).
        'vec3 amsV = normalize(cameraPosition - vWorldPos);',
        'float amsT = pow(max(dot(-amsV, normalize(uSunDir)), 0.0), 2.0);',
        'totalEmissiveRadiance += diffuseColor.rgb * amsT * vH * amsLift * 0.6;',
      ].join('\n'));
  };
  mat.customProgramCacheKey = () => `ams-planetscatter-${opt.key}`;
  return mat;
}

// ---------------------------------------------------------------------------
export class PlanetScatter {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./planetsphere.js').PlanetSphere} planet
   * @param {object} [opts]
   * @param {number} [opts.seed]           deterministic placement seed
   * @param {THREE.Vector3} [opts.sunDir]  world-space unit vector toward the sun
   * @param {number} [opts.density=1]      0..1 scales cover counts
   * @param {number} [opts.windStrength]   object-space bend amount
   */
  constructor(scene, planet, opts = {}) {
    this.scene = scene;
    this.planet = planet;
    this.radius = planet.radius;
    this.seaLevel = planet.seaLevel;
    this.density = Math.max(0, Math.min(1, opts.density ?? 1));
    this.cellUV = CELL_M / this.radius;
    this.seed = (opts.seed ?? 0x5ca77e5) >>> 0;
    this.time = 0;
    // last scattered cell (numeric, compared each frame — no per-frame alloc).
    this._cFace = -1; this._cCi = 0x7fffffff; this._cCj = 0x7fffffff;
    // neighbourhood radius in cells (+margin: cells shrink in metres near cube
    // edges, so over-cover the ring and let the metric ring cull trim it).
    this._R = Math.ceil(RING / CELL_M) + 2;
    this._ring2 = RING * RING;

    // shared uniforms — one update site per frame drives all three meshes.
    const sun = (opts.sunDir ? opts.sunDir.clone() : new THREE.Vector3(0.55, 0.42, 0.72)).normalize();
    this.uniforms = {
      uTime: { value: 0 },
      uWindStrength: { value: opts.windStrength ?? 0.13 },
      uFocus: { value: new THREE.Vector3() },
      uFadeStart: { value: RING - FADE_BAND },
      uFadeEnd: { value: RING },
      uSunDir: { value: sun },
    };

    // the rebased frame: this group tracks (planetCenter - playerUniPos) exactly
    // like PlanetSphere.root, so absolute planet-local instance matrices land on
    // the visible ground.
    this.group = new THREE.Group();
    this.group.name = 'planetScatter';
    scene.add(this.group);

    const grng = new RNG(hash32(this.seed, hashString('scatter-geo')));
    this.grassGeo = buildTuft(grng.fork('tuft'));
    this.plantGeo = buildPlant(grng.fork('plant'));
    this.rockGeo = buildRock(grng.fork('rock'));

    this.grassMat = makeCoverMat(this.uniforms, { key: 'grass', wind: 1.0, lift: 0.62, skyFill: 0.10, side: THREE.DoubleSide, roughness: 0.92 });
    this.plantMat = makeCoverMat(this.uniforms, { key: 'plant', wind: 0.45, lift: 0.42, skyFill: 0.10, side: THREE.DoubleSide, roughness: 0.9 });
    this.rockMat = makeCoverMat(this.uniforms, { key: 'rock', wind: 0.0, lift: 0.16, skyFill: 0.08, side: THREE.FrontSide, roughness: 0.95 });

    this._grass = this._mkMesh(this.grassGeo, this.grassMat, GRASS_CAP, 'scatter:grass');
    this._plant = this._mkMesh(this.plantGeo, this.plantMat, PLANT_CAP, 'scatter:plant');
    this._rock = this._mkMesh(this.rockGeo, this.rockMat, ROCK_CAP, 'scatter:rock');

    // scratch — no per-frame allocation in the hot path.
    this._up = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._t0 = new THREE.Vector3();
    this._b0 = new THREE.Vector3();
    this._T = new THREE.Vector3();
    this._B = new THREE.Vector3();
    this._Y = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._gp = new THREE.Vector3();     // player ground point
    this._cc = new THREE.Vector3();     // cell-centre cull scratch
    this._n = new THREE.Vector3();      // slope sample scratch
    this._m4 = new THREE.Matrix4();
    this._c = new THREE.Color();
    this._face = 0; this._u = 0; this._v = 0;
  }

  _mkMesh(geo, mat, cap, name) {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;   // streamed around the player; bounds are local
    m.castShadow = false;
    m.receiveShadow = false;
    m.name = name;
    this.group.add(m);
    return m;
  }

  /** World-space unit sun vector (drives the back-translucency). */
  setSunDirection(v) { this.uniforms.uSunDir.value.copy(v).normalize(); }

  // --- cube-face parameterisation (a global, seam-consistent grid) ----------

  // Dominant-axis cube face + (u,v) in [-1,1] for a unit-ish direction.
  _faceUV(x, y, z) {
    const ax = Math.abs(x), ay = Math.abs(y), az = Math.abs(z);
    if (ax >= ay && ax >= az) {
      const inv = 1 / ax; this._face = x < 0 ? 1 : 0; this._u = y * inv; this._v = z * inv;
    } else if (ay >= az) {
      const inv = 1 / ay; this._face = y < 0 ? 3 : 2; this._u = x * inv; this._v = z * inv;
    } else {
      const inv = 1 / az; this._face = z < 0 ? 5 : 4; this._u = x * inv; this._v = y * inv;
    }
  }

  // Inverse of _faceUV: (face,u,v) -> unit direction (into out).
  _dirFromFace(face, u, v, out) {
    const a = face >> 1, s = (face & 1) ? -1 : 1;
    if (a === 0) out.set(s, u, v);
    else if (a === 1) out.set(u, s, v);
    else out.set(u, v, s);
    return out.normalize();
  }

  // --- per-frame ------------------------------------------------------------

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3} playerUniPos player position (planet-centre frame)
   * @param {THREE.Vector3} [up] radial up (normalised); derived if omitted
   */
  update(dt, playerUniPos, up) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;

    // rebase our frame under the camera exactly like PlanetSphere.root, and feed
    // the shader the planet-local focus for the distance fade.
    this.group.position.copy(this.planet.planetCenter).sub(playerUniPos);
    this.uniforms.uFocus.value.copy(playerUniPos);

    if (up) this._up.copy(up).normalize();
    else this._up.copy(playerUniPos).normalize();

    // no cover from high flight: hide and force a rebuild once we descend.
    const groundR = this.planet.heightAt(this._up);
    const agl = playerUniPos.length() - groundR;
    if (agl > AGL_CUTOFF) {
      if (this._grass.count) this._grass.count = 0;
      if (this._plant.count) this._plant.count = 0;
      if (this._rock.count) this._rock.count = 0;
      this._cFace = -1;    // force a rebuild once we descend
      return;
    }

    // re-scatter only on a cell crossing.
    this._faceUV(this._up.x, this._up.y, this._up.z);
    const ci = Math.floor(this._u / this.cellUV);
    const cj = Math.floor(this._v / this.cellUV);
    if (this._face === this._cFace && ci === this._cCi && cj === this._cCj) return;
    this._cFace = this._face; this._cCi = ci; this._cCj = cj;
    this._scatter(this._face, ci, cj, groundR);
  }

  // Local surface normal.y at a unit direction, via heightAt central differences
  // in the (t0,b0) tangent frame. eps ~ 1.5 m arc.
  _slopeNy(dir, t0, b0) {
    const eps = 1.5 / this.radius, e = 1.5;
    const n = this._n;
    const hL = this.planet.heightAt(n.copy(dir).addScaledVector(t0, -eps));
    const hR = this.planet.heightAt(n.copy(dir).addScaledVector(t0, eps));
    const hD = this.planet.heightAt(n.copy(dir).addScaledVector(b0, -eps));
    const hU = this.planet.heightAt(n.copy(dir).addScaledVector(b0, eps));
    const du = hR - hL, dv = hU - hD, e2 = 2 * e;
    return e2 / Math.sqrt(du * du + e2 * e2 + dv * dv);
  }

  // Rebuild all three instance buffers for the neighbourhood around (face,ci,cj).
  _scatter(face, ci, cj, groundR) {
    // player ground point (metric ring cull is measured from here).
    this._gp.copy(this._up).multiplyScalar(groundR);
    const cellUV = this.cellUV, sea = this.seaLevel, R = this._R;
    // discard whole cells whose centre can't reach the ring (approx radius =
    // player groundR) — keeps the neighbourhood square cheap without heightAt.
    const cullR = RING + CELL_M * 1.6, cull2 = cullR * cullR;
    let gN = 0, pN = 0, rN = 0;

    for (let dj = -R; dj <= R; dj++) {
      const cellJ = cj + dj;
      for (let di = -R; di <= R; di++) {
        const cellI = ci + di;
        // cell-centre cull (cheap: reuse the player ground radius as a proxy).
        this._dirFromFace(face, (cellI + 0.5) * cellUV, (cellJ + 0.5) * cellUV, this._cc);
        if (this._cc.multiplyScalar(groundR).distanceToSquared(this._gp) > cull2) continue;
        const rng = new RNG(hash32(this.seed, face, cellI, cellJ));

        // --- grass ---
        for (let i = 0; i < PER_CELL_GRASS; i++) {
          if (gN >= GRASS_CAP) break;
          const u = (cellI + rng.next()) * cellUV;
          const v = (cellJ + rng.next()) * cellUV;
          const yaw = rng.next() * Math.PI * 2;
          const s = rng.range(0.4, 0.72);
          const shade = rng.range(0.82, 1.05);
          const hueT = rng.next();
          if (rng.next() > this.density) continue;
          const dir = this._dirFromFace(face, u, v, this._dir);
          const r = this.planet.heightAt(dir);
          const alt = r - sea, lat = Math.abs(dir.y);
          const snow = 155 * (1 - lat * 0.7);
          if (alt < GRASS_MIN_ALT || alt > snow * SNOW_MARGIN) continue;
          this._pos.copy(dir).multiplyScalar(r);
          if (this._pos.distanceToSquared(this._gp) > this._ring2) continue;
          this._tangents(dir);
          if (this._slopeNy(dir, this._t0, this._b0) < SLOPE_MIN_SOFT) continue;
          const t = THREE.MathUtils.smoothstep(alt, 8, 62);
          this._c.copy(GRASS_LOW).lerp(GRASS_HI, t * 0.7 + hueT * 0.2).multiplyScalar(shade);
          this._place(this._grass, gN++, dir, yaw, s, s, r);
          this._grass.setColorAt(gN - 1, this._c);
        }

        // --- plant ---
        for (let i = 0; i < PER_CELL_PLANT; i++) {
          if (pN >= PLANT_CAP) break;
          const u = (cellI + rng.next()) * cellUV;
          const v = (cellJ + rng.next()) * cellUV;
          const yaw = rng.next() * Math.PI * 2;
          const sxz = rng.range(0.5, 0.95), sy = rng.range(0.55, 1.15);
          const shade = rng.range(0.75, 1.0);
          const hueT = rng.next();
          if (rng.next() > this.density * 0.8) continue;
          const dir = this._dirFromFace(face, u, v, this._dir);
          const r = this.planet.heightAt(dir);
          const alt = r - sea, lat = Math.abs(dir.y);
          const snow = 155 * (1 - lat * 0.7);
          if (alt < GRASS_MIN_ALT || alt > snow * SNOW_MARGIN) continue;
          this._pos.copy(dir).multiplyScalar(r);
          if (this._pos.distanceToSquared(this._gp) > this._ring2) continue;
          this._tangents(dir);
          if (this._slopeNy(dir, this._t0, this._b0) < SLOPE_MIN_SOFT) continue;
          const t = THREE.MathUtils.smoothstep(alt, 8, 62);
          this._c.copy(PLANT_LOW).lerp(PLANT_HI, t * 0.6 + hueT * 0.25).multiplyScalar(shade);
          this._place(this._plant, pN++, dir, yaw, sxz, sy, r);
          this._plant.setColorAt(pN - 1, this._c);
        }

        // --- rock ---
        for (let i = 0; i < PER_CELL_ROCK; i++) {
          if (rN >= ROCK_CAP) break;
          const u = (cellI + rng.next()) * cellUV;
          const v = (cellJ + rng.next()) * cellUV;
          const yaw = rng.next() * Math.PI * 2;
          const sxz = rng.range(0.4, 1.05), sy = rng.range(0.35, 0.9);
          const shade = rng.range(0.72, 1.0);
          const hueT = rng.next();
          if (rng.next() > this.density * 0.7) continue;
          const dir = this._dirFromFace(face, u, v, this._dir);
          const r = this.planet.heightAt(dir);
          const alt = r - sea, lat = Math.abs(dir.y);
          const snow = 155 * (1 - lat * 0.7);
          if (alt < 0 || alt > snow + 45) continue;       // rocks up onto the caps
          this._pos.copy(dir).multiplyScalar(r);
          if (this._pos.distanceToSquared(this._gp) > this._ring2) continue;
          this._tangents(dir);
          if (this._slopeNy(dir, this._t0, this._b0) < SLOPE_MIN_ROCK) continue;
          const t = THREE.MathUtils.smoothstep(alt, 40, snow + 20);
          this._c.copy(ROCK_LOW).lerp(ROCK_HI, t * 0.8 + hueT * 0.15).multiplyScalar(shade);
          this._place(this._rock, rN++, dir, yaw, sxz, sy, r);
          this._rock.setColorAt(rN - 1, this._c);
        }
      }
    }

    this._grass.count = gN; this._grass.instanceMatrix.needsUpdate = true;
    if (this._grass.instanceColor) this._grass.instanceColor.needsUpdate = true;
    this._plant.count = pN; this._plant.instanceMatrix.needsUpdate = true;
    if (this._plant.instanceColor) this._plant.instanceColor.needsUpdate = true;
    this._rock.count = rN; this._rock.instanceMatrix.needsUpdate = true;
    if (this._rock.instanceColor) this._rock.instanceColor.needsUpdate = true;
  }

  // Deterministic orthonormal tangent pair at a radial dir (into _t0,_b0).
  _tangents(dir) {
    const t0 = this._t0;
    t0.set(0, 1, 0);
    if (Math.abs(dir.y) > 0.9) t0.set(1, 0, 0);
    t0.addScaledVector(dir, -t0.dot(dir)).normalize();
    this._b0.crossVectors(dir, t0).normalize();   // up x t0
  }

  // Compose an ABSOLUTE planet-local instance matrix: local +Y -> radial dir,
  // random yaw about it, (sxz,sy,sxz) scale, position = dir * r (r=heightAt(dir)).
  _place(mesh, idx, dir, yaw, sxz, sy, r) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // T = yawed tangent; B = T x up  -> (T, up, B) right-handed (correct winding).
    this._T.copy(this._t0).multiplyScalar(c).addScaledVector(this._b0, s);
    this._B.crossVectors(this._T, dir);
    this._T.multiplyScalar(sxz);
    this._B.multiplyScalar(sxz);
    this._Y.copy(dir).multiplyScalar(sy);
    this._m4.makeBasis(this._T, this._Y, this._B);
    this._m4.setPosition(dir.x * r, dir.y * r, dir.z * r);
    mesh.setMatrixAt(idx, this._m4);
  }

  dispose() {
    this.scene.remove(this.group);
    this._grass.dispose(); this._plant.dispose(); this._rock.dispose();
    this.grassGeo.dispose(); this.plantGeo.dispose(); this.rockGeo.dispose();
    this.grassMat.dispose(); this.plantMat.dispose(); this.rockMat.dispose();
  }
}
