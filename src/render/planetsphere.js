// PlanetSphere — a REAL seamless spherical planet.
//
// One round world you fly from orbit to the surface with no cut: a cube-sphere
// whose six faces are each a quadtree of chunks that split/merge by
// screen-space size, displaced along the sphere normal by multi-octave 3D
// simplex noise (continents + ridged mountains + detail), rendered
// camera-relative (floating origin) so 32-bit float precision holds at
// planetary scale. A sea-level sphere and a back-side Fresnel atmosphere shell
// complete the look.
//
// This is a self-contained prototype module. It does not touch the live game.
//
// PUBLIC API
//   const p = new PlanetSphere(scene, { seed, radius, seaLevel });
//   p.update(dt, cameraWorldPos)  // LOD split/merge + floating-origin rebase + atmosphere
//   p.heightAt(dirVec3) -> number // terrain radius (planet-local) along a unit direction
//   p.setSunDirection(vec3)       // world-space unit vector toward the sun (drives atmosphere)
//   p.setPlanetCenter(vec3)       // universe-space centre of the planet (default 0,0,0)
//   p.getStats() -> { leaves, triangles, builds }
//   p.dispose()
//
// COST NOTES
//   - The per-frame update() walks the quadtree doing only scalar distance math
//     and Vector3.distanceTo (no allocation). It is O(active nodes) ~ a few
//     hundred and cheap.
//   - Actual GPU geometry is (re)built ONLY on a split or merge event, not per
//     frame. A chunk build allocates a handful of typed arrays and does
//     ~(GRID+3)^2 height samples plus 2 extra samples/vertex for analytic
//     normals. During a fast descent a few chunks rebuild per frame; a full
//     cold build of the near field is a few ms. See buildBudget to cap it.

import * as THREE from 'three';
import { SimplexNoise } from '../core/noise.js';
import { hash32 } from '../core/rng.js';

// ---------------------------------------------------------------------------
// Cube-sphere face basis. Each face is a plane in cube space spanned by (u, v)
// with outward normal n; u x v == +n for every face so triangle winding stays
// consistent (CCW = outward = front face). A cube point (n + u*s + v*t),
// s,t in [-1,1], normalized to unit length gives the sphere direction.
// ---------------------------------------------------------------------------
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },  // +X
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },  // -X
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },  // +Y
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },  // -Y
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },  // +Z
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] }, // -Z
];

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Ridged multifractal in 3D (sharp mountain ridges), returns roughly [0,1].
function ridged3(noise, x, y, z, octaves, lacunarity = 2.0, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise.noise3D(x * freq, y * freq, z * freq));
    n *= n;
    sum += n * amp * prev;
    prev = n;
    amp *= gain; freq *= lacunarity;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Chunk: one quadtree node on a cube face. Owns either a mesh (leaf) or four
// children. Distance-to-camera drives split/merge.
// ---------------------------------------------------------------------------
class Chunk {
  constructor(planet, faceIdx, cu, cv, half, depth) {
    this.planet = planet;
    this.faceIdx = faceIdx;
    this.cu = cu;          // node centre in face-uv space [-1,1]
    this.cv = cv;
    this.half = half;      // half extent in face-uv space
    this.depth = depth;
    this.mesh = null;
    this.children = null;

    // Precompute the node's sphere-surface centre (planet-local) and an
    // approximate world-space edge size, used for the LOD screen-space test.
    const f = FACES[faceIdx];
    this.centerLocal = new THREE.Vector3();
    this._dir(cu, cv, this.centerLocal);
    const cr = planet._surfaceRadius(this.centerLocal.x, this.centerLocal.y, this.centerLocal.z);
    this.centerLocal.multiplyScalar(cr);

    // Edge chord length ~ angular width * radius; use the max of the two axes.
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    this._dir(cu - half, cv, a); this._dir(cu + half, cv, b);
    const eu = a.distanceTo(b) * planet.radius;
    this._dir(cu, cv - half, a); this._dir(cu, cv + half, b);
    const ev = a.distanceTo(b) * planet.radius;
    this.worldSize = Math.max(eu, ev);
  }

  // face-uv (s,t) -> unit sphere direction, into `out`.
  _dir(s, t, out) {
    const f = FACES[this.faceIdx];
    const x = f.n[0] + f.u[0] * s + f.v[0] * t;
    const y = f.n[1] + f.u[1] * s + f.v[1] * t;
    const z = f.n[2] + f.u[2] * s + f.v[2] * t;
    return out.set(x, y, z).normalize();
  }

  // Screen-space-error style metric: chunk angular size = worldSize / distance.
  // Nearest-point distance keeps chunks under the camera splitting hardest.
  _ratio(camLocal) {
    const d = camLocal.distanceTo(this.centerLocal) - this.worldSize * 0.5;
    return this.worldSize / Math.max(d, 1.0);
  }

  update(camLocal) {
    const p = this.planet;
    const ratio = this._ratio(camLocal);
    if (this.children) {
      // merge when comfortably below the split threshold (hysteresis avoids
      // flip-flop popping across the boundary)
      if (ratio < p.splitRatio * 0.5 || this.depth >= p.maxDepth) {
        this._merge();
        this._ensureMesh();
      } else {
        for (let i = 0; i < 4; i++) this.children[i].update(camLocal);
      }
      return;
    }
    if (this.depth < p.maxDepth && ratio > p.splitRatio) {
      this._split();
      for (let i = 0; i < 4; i++) this.children[i].update(camLocal);
    } else {
      this._ensureMesh();
    }
  }

  _split() {
    if (this.children) return;
    this._disposeMesh();
    const h = this.half * 0.5, d = this.depth + 1;
    this.children = [
      new Chunk(this.planet, this.faceIdx, this.cu - h, this.cv - h, h, d),
      new Chunk(this.planet, this.faceIdx, this.cu + h, this.cv - h, h, d),
      new Chunk(this.planet, this.faceIdx, this.cu - h, this.cv + h, h, d),
      new Chunk(this.planet, this.faceIdx, this.cu + h, this.cv + h, h, d),
    ];
  }

  _merge() {
    if (!this.children) return;
    for (let i = 0; i < 4; i++) this.children[i]._destroy();
    this.children = null;
  }

  _destroy() {
    this._merge();
    this._disposeMesh();
  }

  _ensureMesh() {
    if (this.mesh || this.children) return;
    this.mesh = this.planet._buildChunkMesh(this);
    this.planet.root.add(this.mesh);
    this.planet._builds++;
  }

  _disposeMesh() {
    if (!this.mesh) return;
    this.planet.root.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh = null;
  }
}

// ---------------------------------------------------------------------------
export class PlanetSphere {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts
   * @param {number} [opts.seed=1337]
   * @param {number} [opts.radius=4000]  planet base radius (world units)
   * @param {number} [opts.seaLevel=radius]  absolute sea radius
   * @param {number} [opts.maxDepth=8]   quadtree depth cap (near-surface detail)
   * @param {number} [opts.grid=16]      quads per chunk edge
   * @param {number} [opts.splitRatio=0.16]  split when worldSize/dist exceeds this
   */
  constructor(scene, opts = {}) {
    const seed = (opts.seed ?? 1337) >>> 0;
    this.scene = scene;
    this.radius = opts.radius ?? 4000;
    this.seaLevel = opts.seaLevel ?? this.radius;
    this.maxDepth = opts.maxDepth ?? 7;
    this.grid = opts.grid ?? 16;
    this.splitRatio = opts.splitRatio ?? 0.28;

    // Elevation amplitudes as a fraction of radius (gameplay-exaggerated relief).
    this.contAmp = this.radius * 0.018;  // rolling continents
    this.mtnAmp = this.radius * 0.045;   // ridged mountain ranges
    this.detAmp = this.radius * 0.005;   // fine surface detail
    this._floor = this.radius * 0.965;   // ocean-basin floor clamp

    // Skirt depth as a fraction of a chunk's world size — hangs a vertical
    // flange off each chunk edge to hide LOD T-junction cracks.
    this.skirtFactor = 0.5;

    // Deterministic noise fields for the three terrain layers.
    this.contNoise = new SimplexNoise(seed);
    this.mtnNoise = new SimplexNoise(hash32(seed, 0x4d) >>> 0);
    this.detNoise = new SimplexNoise(hash32(seed, 0x9a) >>> 0);

    this.planetCenter = new THREE.Vector3(0, 0, 0);
    this._camLocal = new THREE.Vector3();
    this._builds = 0;

    // Root group holds terrain chunks + sea + atmosphere. update() sets its
    // position to (planetCenter - cameraWorldPos): camera-relative rendering.
    this.root = new THREE.Group();
    this.root.name = 'planetSphere';
    scene.add(this.root);

    // Shared terrain material — vertex-coloured, matte, receives the scene's
    // directional (sun) light. Works on SwiftShader; log-depth is injected by
    // three automatically when the renderer enables logarithmicDepthBuffer.
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0,
    });

    this._buildFaces();
    this._buildSea();
    this._buildAtmosphere();
  }

  _buildFaces() {
    this.faces = [];
    for (let f = 0; f < 6; f++) {
      this.faces.push(new Chunk(this, f, 0, 0, 1, 0));
    }
  }

  // --- terrain field -------------------------------------------------------

  // Elevation offset (may be negative) at a unit direction (components).
  _elevation(nx, ny, nz) {
    const cont = this.contNoise.fbm3(nx * 1.5 + 11.3, ny * 1.5 + 3.1, nz * 1.5 + 7.7, 5);
    const land = smoothstep(-0.06, 0.20, cont);
    const ridge = ridged3(this.mtnNoise, nx * 2.7 + 1.2, ny * 2.7 + 4.5, nz * 2.7 + 9.9, 5);
    const mont = ridge * land * (0.35 + 0.65 * smoothstep(0.0, 0.45, cont));
    const det = this.detNoise.fbm3(nx * 9.0 + 2.0, ny * 9.0 + 5.0, nz * 9.0 + 1.0, 3);
    return cont * this.contAmp + mont * this.mtnAmp + det * this.detAmp * land;
  }

  // Terrain radius (planet-local) along a unit direction, floor-clamped.
  _surfaceRadius(nx, ny, nz) {
    const r = this.radius + this._elevation(nx, ny, nz);
    return r < this._floor ? this._floor : r;
  }

  /** Terrain radius along a unit direction — for walking/collision later. */
  heightAt(dir) {
    const l = Math.hypot(dir.x, dir.y, dir.z) || 1;
    return this._surfaceRadius(dir.x / l, dir.y / l, dir.z / l);
  }

  // Biome colour by altitude-above-sea and latitude, written into (out*) as
  // LINEAR rgb (THREE.Color.setHex converts from sRGB for us).
  _biomeColor(r, nx, ny, nz, col) {
    const alt = r - this.seaLevel;
    const lat = Math.abs(ny);            // pole axis = y
    if (alt < 0) {
      // underwater floor: shallow teal -> deep navy (still visible at shore)
      const t = smoothstep(0, -140, alt);
      col.setHex(0x2a6f97).lerp(SCRATCH_COL.setHex(0x05213a), t);
      return col;
    }
    // Land ramp. Snow line drops toward the poles.
    const snowStart = 155 * (1 - lat * 0.7);
    col.setHex(0xcdb98f); // beach sand baseline
    // beach -> grass
    col.lerp(SCRATCH_COL.setHex(0x4f7a3a), smoothstep(3, 26, alt));
    // grass -> rock
    col.lerp(SCRATCH_COL.setHex(0x6d5f4d), smoothstep(60, snowStart * 0.72, alt));
    // rock -> snow
    col.lerp(SCRATCH_COL.setHex(0xf2f5fb), smoothstep(snowStart, snowStart + 55, alt));
    // extra polar whitening regardless of altitude
    col.lerp(SCRATCH_COL.setHex(0xf2f5fb), smoothstep(0.80, 0.96, lat) * 0.85);
    return col;
  }

  // --- chunk geometry ------------------------------------------------------

  // Build a leaf chunk mesh. Geometry is a (grid+3)^2 vertex grid: the inner
  // (grid+1)^2 is the surface, the surrounding ring is a downward skirt whose
  // horizontal position is clamped to the edge (a vertical flange). Analytic
  // normals come from finite differences on the true (un-skirted) surface so
  // that shared edges between neighbours match and lighting has no seam.
  _buildChunkMesh(chunk) {
    const N = this.grid;
    const W = N + 3;                       // points per side incl. skirt ring
    const nVerts = W * W;
    const pos = new Float32Array(nVerts * 3);
    const nrm = new Float32Array(nVerts * 3);
    const colArr = new Float32Array(nVerts * 3);
    const surf = new Float32Array(nVerts * 3);   // true surface pos (for normals)
    const dirs = new Float32Array(nVerts * 3);   // unit sphere dir (for outward test)

    const f = FACES[chunk.faceIdx];
    const cu = chunk.cu, cv = chunk.cv, half = chunk.half;
    const s0 = cu - half, t0 = cv - half, span = 2 * half;
    const skirt = chunk.worldSize * this.skirtFactor;
    const col = SCRATCH_COL2;

    for (let gy = 0; gy < W; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const k = gy * W + gx;
        const i = gx - 1, j = gy - 1;             // -1 .. N+1
        const ci = i < 0 ? 0 : i > N ? N : i;     // clamp to surface grid
        const cj = j < 0 ? 0 : j > N ? N : j;
        const isSkirt = (i !== ci) || (j !== cj);

        // surf[] (used for normals) samples the EXTENDED position — one cell
        // beyond the node on the skirt ring — so central differences at a chunk
        // border use the true neighbouring surface. Equal-LOD neighbours then
        // compute identical edge normals: no lighting seam.
        const se = s0 + (i / N) * span, te = t0 + (j / N) * span;
        let ex = f.n[0] + f.u[0] * se + f.v[0] * te;
        let ey = f.n[1] + f.u[1] * se + f.v[1] * te;
        let ez = f.n[2] + f.u[2] * se + f.v[2] * te;
        const ei = 1 / Math.hypot(ex, ey, ez);
        ex *= ei; ey *= ei; ez *= ei;
        const rE = this._surfaceRadius(ex, ey, ez);
        surf[k * 3] = ex * rE; surf[k * 3 + 1] = ey * rE; surf[k * 3 + 2] = ez * rE;

        // Geometry uses the CLAMPED position: interior == surface; the skirt
        // ring keeps the border's horizontal but drops radially by `skirt`,
        // forming a vertical flange that hides LOD cracks.
        let dx, dy, dz, rC;
        if (isSkirt) {
          const sc = s0 + (ci / N) * span, tc = t0 + (cj / N) * span;
          dx = f.n[0] + f.u[0] * sc + f.v[0] * tc;
          dy = f.n[1] + f.u[1] * sc + f.v[1] * tc;
          dz = f.n[2] + f.u[2] * sc + f.v[2] * tc;
          const ic = 1 / Math.hypot(dx, dy, dz);
          dx *= ic; dy *= ic; dz *= ic;
          rC = this._surfaceRadius(dx, dy, dz);
          const r = rC - skirt;
          pos[k * 3] = dx * r; pos[k * 3 + 1] = dy * r; pos[k * 3 + 2] = dz * r;
        } else {
          dx = ex; dy = ey; dz = ez; rC = rE;
          pos[k * 3] = surf[k * 3]; pos[k * 3 + 1] = surf[k * 3 + 1]; pos[k * 3 + 2] = surf[k * 3 + 2];
        }
        dirs[k * 3] = dx; dirs[k * 3 + 1] = dy; dirs[k * 3 + 2] = dz;

        this._biomeColor(rC, dx, dy, dz, col);
        colArr[k * 3] = col.r; colArr[k * 3 + 1] = col.g; colArr[k * 3 + 2] = col.b;
      }
    }

    // Analytic normals from central differences on the surface grid.
    for (let gy = 0; gy < W; gy++) {
      for (let gx = 0; gx < W; gx++) {
        const k = gy * W + gx;
        const kxm = (gy * W + (gx > 0 ? gx - 1 : gx)) * 3;
        const kxp = (gy * W + (gx < W - 1 ? gx + 1 : gx)) * 3;
        const kym = ((gy > 0 ? gy - 1 : gy) * W + gx) * 3;
        const kyp = ((gy < W - 1 ? gy + 1 : gy) * W + gx) * 3;
        const ux = surf[kxp] - surf[kxm], uy = surf[kxp + 1] - surf[kxm + 1], uz = surf[kxp + 2] - surf[kxm + 2];
        const vx = surf[kyp] - surf[kym], vy = surf[kyp + 1] - surf[kym + 1], vz = surf[kyp + 2] - surf[kym + 2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        nx /= nl; ny /= nl; nz /= nl;
        // ensure outward (align with sphere direction)
        if (nx * dirs[k * 3] + ny * dirs[k * 3 + 1] + nz * dirs[k * 3 + 2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
        nrm[k * 3] = nx; nrm[k * 3 + 1] = ny; nrm[k * 3 + 2] = nz;
      }
    }

    // Indices — CCW-outward winding (front faces).
    const quads = (W - 1) * (W - 1);
    const idx = new (nVerts > 65535 ? Uint32Array : Uint16Array)(quads * 6);
    let o = 0;
    for (let gy = 0; gy < W - 1; gy++) {
      for (let gx = 0; gx < W - 1; gx++) {
        const a = gy * W + gx;
        const b = a + 1;
        const c = a + W;
        const d = c + 1;
        idx[o++] = a; idx[o++] = b; idx[o++] = c;
        idx[o++] = b; idx[o++] = d; idx[o++] = c;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;   // chunk sits at root origin; verts are absolute
    mesh.updateMatrix();
    return mesh;
  }

  // --- sea + atmosphere ----------------------------------------------------

  _buildSea() {
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x184b7a, roughness: 0.18, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    });
    this.seaMesh = new THREE.Mesh(new THREE.SphereGeometry(this.seaLevel, 128, 96), this.seaMat);
    this.seaMesh.name = 'sea';
    this.seaMesh.renderOrder = 1;
    this.root.add(this.seaMesh);
  }

  _buildAtmosphere() {
    const shellR = this.radius * 1.035;
    const ratio = this.radius / shellR;
    const muMax = Math.sqrt(Math.max(1 - ratio * ratio, 1e-4));
    this.atmoMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x5aa2ff) },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uMuMax: { value: muMax },
        uStrength: { value: 1.35 },
      },
      vertexShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_vertex>
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: /* glsl */`
        #include <common>
        #include <logdepthbuf_pars_fragment>
        uniform vec3 uColor;
        uniform vec3 uSunDir;
        uniform float uMuMax;
        uniform float uStrength;
        varying vec3 vNormalW;
        varying vec3 vWorldPos;
        void main() {
          #include <logdepthbuf_fragment>
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 N = normalize(vNormalW);
          float mu = clamp(-dot(V, N) / uMuMax, 0.0, 1.0);
          float glow = pow(mu, 1.8) * 0.75 + pow(mu, 7.0) * 0.55 + mu * 0.07;
          vec3 rim = N - V * dot(N, V);
          float sunSide = dot(normalize(rim + 1e-4), uSunDir);
          float day = pow(clamp(sunSide * 0.62 + 0.45, 0.0, 1.0), 1.6);
          day = max(day, 0.03);
          float glare = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 6.0) * 0.6 * mu;
          vec3 c = uColor * (glow * day * uStrength) + uColor * glare;
          gl_FragColor = vec4(c, 1.0);
        }`,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    this.atmoMesh = new THREE.Mesh(new THREE.SphereGeometry(shellR, 64, 48), this.atmoMat);
    this.atmoMesh.name = 'atmosphere';
    this.atmoMesh.renderOrder = 4;
    this.root.add(this.atmoMesh);
  }

  /** World-space unit vector pointing toward the sun (lights the atmo limb). */
  setSunDirection(v) { this.atmoMat.uniforms.uSunDir.value.copy(v).normalize(); }

  /** Universe-space centre of the planet (default origin). */
  setPlanetCenter(v) { this.planetCenter.copy(v); }

  // --- per-frame -----------------------------------------------------------

  /**
   * @param {number} dt seconds (reserved; no time-based motion here)
   * @param {THREE.Vector3} cameraWorldPos camera position in universe space
   */
  update(dt, cameraWorldPos) {
    // Floating origin: place the planet so the camera sits near world origin.
    // Everything the shader sees is then small-magnitude -> float32 precision
    // holds even though the universe coordinate may be huge.
    this.root.position.copy(this.planetCenter).sub(cameraWorldPos);
    this.root.updateMatrixWorld(true);

    // Camera position in planet-local space drives LOD.
    this._camLocal.copy(cameraWorldPos).sub(this.planetCenter);
    for (let i = 0; i < 6; i++) this.faces[i].update(this._camLocal);
  }

  /** { leaves, triangles, builds } — walks the tree; call sparingly. */
  getStats() {
    let leaves = 0, tris = 0;
    const walk = (c) => {
      if (c.children) { for (let i = 0; i < 4; i++) walk(c.children[i]); return; }
      if (c.mesh) { leaves++; tris += c.mesh.geometry.index.count / 3; }
    };
    for (let i = 0; i < 6; i++) walk(this.faces[i]);
    return { leaves, triangles: tris, builds: this._builds };
  }

  dispose() {
    for (let i = 0; i < 6; i++) this.faces[i]._destroy();
    this.faces = null;
    this.terrainMat.dispose();
    this.seaMesh.geometry.dispose(); this.seaMat.dispose();
    this.atmoMesh.geometry.dispose(); this.atmoMat.dispose();
    this.scene.remove(this.root);
  }
}

// Scratch colours reused inside the hot build loop (no per-vertex allocation).
const SCRATCH_COL = new THREE.Color();
const SCRATCH_COL2 = new THREE.Color();
