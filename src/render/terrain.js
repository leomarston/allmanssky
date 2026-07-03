// TerrainRenderer — streams 64 m heightfield chunks in rings around the focus
// position with distance LOD (32/16/8 vertex grids) and skirt flaps that hide
// LOD seams. Vertex colors ramp the planet palette by height, slope, moisture
// and biome snow, with noise dithering against banding. Includes a single
// large animated sea plane (depth-tinted, normal-perturbed spec) that follows
// the focus. Chunk geometry is pooled and disposed properly.
import * as THREE from 'three';
import { hash32, hashString } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

const CHUNK = 64;
const LOD_SEGS = [32, 16, 8];
const LOD_NEAR = 3.4, LOD_MID = 6.9; // chunk-space radii for LOD bands
const SEA_SIZE = 2200;               // sea plane width (m)
const SEA_REGION = 2300;             // depth-texture coverage (m)
const SEA_TEX = 96;                  // depth-texture resolution
const POOL_MAX = 80;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
function toColor(v, fallback) { return new THREE.Color(v ?? fallback); }

/**
 * Seamless-tiling noise texture for ground detail. R = fine grain (sampled
 * ~5 m tiles), G = broad mottle (~32 m tiles). Sampled in world space.
 */
function makeDetailTexture(seed) {
  const S = 256;
  const n1 = new SimplexNoise(hash32(seed, 771));
  const n2 = new SimplexNoise(hash32(seed, 772));
  const img = new Uint8Array(S * S * 4);
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // torus-sample the noise so the tile wraps seamlessly
      const a = (x / S) * TAU, b = (y / S) * TAU;
      const nx = Math.cos(a) * 1.6, ny = Math.sin(a) * 1.6;
      const nz = Math.cos(b) * 1.6, nw = Math.sin(b) * 1.6;
      const fine = n1.fbm3(nx * 2.3 + nz * 1.7, ny * 2.3 + nw * 1.7, nz * 2.9, 4)
        + n1.noise3D(nx * 7.1, ny * 7.1, nz * 7.1 + nw * 3.3) * 0.35;
      const mid = n2.fbm3(nx + nz * 0.8, ny + nw * 0.8, nw * 1.2, 3);
      const i = (y * S + x) * 4;
      img[i] = Math.max(0, Math.min(255, 128 + fine * 108));
      img[i + 1] = Math.max(0, Math.min(255, 128 + mid * 118));
      img[i + 2] = 128;
      img[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(img, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const _c = new THREE.Color();
const _lowC = new THREE.Color();
const _midC = new THREE.Color();

// --------------------------------------------------------------------------
// Sea shader (fog + log-depth aware; alpha-blended over the terrain).
const SEA_VERT = /* glsl */ `
#include <common>
varying vec3 vWorld;
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}
`;

const SEA_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform sampler2D uDepthTex;
uniform vec3 uRegion; // x0, z0, 1/span
varying vec3 vWorld;
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>

vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 uv = clamp((vWorld.xz - uRegion.xy) * uRegion.z, 0.0, 1.0);
  float depth01 = texture2D(uDepthTex, uv).r;
  float t = uTime;
  vec2 p = vWorld.xz;
  // wave normal: two simplex fields + cheap sine chop
  float w1 = snoise(p * 0.055 + vec2(t * 0.05, t * 0.04));
  float w2 = snoise(p * 0.21 + vec2(-t * 0.08, t * 0.06) + w1 * 0.6);
  float sx = sin(p.x * 0.9 + t * 1.4) * 0.07 + sin(p.x * 0.13 - t * 0.7) * 0.15;
  float sz = sin(p.y * 0.8 - t * 1.1) * 0.07 + sin(p.y * 0.17 + t * 0.8) * 0.15;
  vec3 n = normalize(vec3(w1 * 0.5 + w2 * 0.35 + sx, 2.4, w2 * 0.5 - w1 * 0.28 + sz));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.03, 0.55, depth01));
  #ifdef USE_FOG
  float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
  col = mix(col, fogColor, 0.22 + 0.5 * fres); // sky reflection ≈ horizon/fog color
  #endif
  vec3 R = reflect(-uSunDir, n);
  float spec = pow(max(dot(R, V), 0.0), 140.0);
  col += uSunCol * spec * 2.2; // HDR glints feed bloom
  float foam = smoothstep(0.05, 0.004, depth01);
  foam *= 0.4 + 0.35 * snoise(p * 0.9 + vec2(t * 0.25, -t * 0.2));
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(0.88, 0.93, 0.95), foam * 0.55);
  float alpha = mix(0.58, 0.93, smoothstep(0.0, 0.3, depth01));
  alpha = max(alpha, foam * 0.75);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}
`;

/**
 * Streaming chunked terrain renderer for a planet surface.
 * Owns its scene-graph objects; call update(dt, focusPos) each frame and
 * dispose() when leaving the surface.
 */
export class TerrainRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {object} def PlanetDef
   * @param {import('../universe/terrainfield.js').TerrainField} field
   * @param {object} [opts] { viewChunks } ring radius in chunks (default 12)
   */
  constructor(scene, def, field, opts = {}) {
    this.scene = scene;
    this.def = def;
    this.field = field;
    // 9-chunk ring ≈ 576 m — the fog wall sits inside that, so farther chunks
    // were paying draw calls for pixels the fog already owns
    this.viewChunks = opts.viewChunks ?? 9;

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    const seed = (def.seed ?? hashString(String(def.id ?? 'p'))) >>> 0;
    this._nPatch = new SimplexNoise(hash32(seed, 201));
    this._nDither = new SimplexNoise(hash32(seed, 202));

    // palette
    const P = def.palette ?? {};
    this._deep = toColor(P.deepWater, '#0b3050');
    this._shallow = toColor(P.shallowWater, '#2e93a8');
    this._shore = toColor(P.shore, '#d6c78f');
    this._high = toColor(P.high, '#8a7a5e');
    this._peak = toColor(P.peak, '#e9edf3');
    this._cliff = toColor(P.cliff, '#6b6258');
    const low = toColor(P.low, '#5fa84e');
    const mid = toColor(P.mid, '#3e7c3c');
    this._lowA = low.clone().offsetHSL(0.015, 0.05, 0.03);
    this._lowB = low.clone().offsetHSL(-0.02, -0.05, -0.04);
    this._midA = mid.clone().offsetHSL(0.012, 0.04, 0.02);
    this._midB = mid.clone().offsetHSL(-0.018, -0.04, -0.03);
    this._wet = low.clone().lerp(this._deep, 0.3).multiplyScalar(0.72);
    this._dry = this._shore.clone().lerp(low, 0.3);
    this._snow = new THREE.Color('#e8f1fa');

    const relief = clamp01(def.terrain?.relief ?? 0.5);
    this._bandScale = 0.45 + 0.75 * relief;
    this._baseY = Number.isFinite(field.seaY) ? field.seaY : -field.contAmp * 0.45;
    const frozen = def.biome === 'frozen';
    this._snowY = frozen ? this._baseY + 1.5 : this._baseY + 68 * this._bandScale;

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0,
    });
    // world-space detail albedo: vertex colors are ~2 m resolution, far too
    // coarse to read up close — two octaves of tiling noise carry the sub-metre
    // grain (soil mottle + fine speckle) that makes ground feel material
    this._detailTex = makeDetailTexture(seed);
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uDetail = { value: this._detailTex };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vAmsWorld;')
        .replace('#include <begin_vertex>',
          '#include <begin_vertex>\nvAmsWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec3 vAmsWorld;')
        .replace('#include <color_fragment>', [
          '#include <color_fragment>',
          'float dNear = texture2D(uDetail, vAmsWorld.xz * 0.19).r;',
          'float dMid  = texture2D(uDetail, vAmsWorld.xz * 0.031).g;',
          'float dFade = 1.0 - smoothstep(60.0, 260.0, length(vAmsWorld - cameraPosition));',
          'diffuseColor.rgb *= 1.0 + (dNear - 0.5) * 0.34 * dFade + (dMid - 0.5) * 0.22;',
        ].join('\n'));
    };
    this.material.customProgramCacheKey = () => 'ams-terrain-detail';

    // chunk bookkeeping
    this.chunks = new Map();               // "cx,cz" -> { mesh, lod, cx, cz }
    this._pool = [[], [], []];             // recycled geometries per LOD
    this._indices = [null, null, null];    // shared index attribute per LOD
    this._scratch = LOD_SEGS.map((s) => new Float32Array((s + 3) * (s + 3)));
    this._queue = [];
    this._fx = Infinity; this._fz = Infinity;
    this._first = true;

    // sun fallback for the sea shader (overridable via update args / scene scan)
    this._sunDir = new THREE.Vector3(0.45, 0.65, 0.4).normalize();
    this._sunCol = new THREE.Color(1.5, 1.3, 1.0);
    this._sunScan = 0;

    this._sea = null;
    if ((def.seaLevel ?? 0) > 0 && Number.isFinite(field.seaY)) this._buildSea();
  }

  // ------------------------------------------------------------------ sea
  _buildSea() {
    this._seaData = new Uint8Array(SEA_TEX * SEA_TEX);
    this._seaTex = new THREE.DataTexture(this._seaData, SEA_TEX, SEA_TEX, THREE.RedFormat, THREE.UnsignedByteType);
    this._seaTex.magFilter = THREE.LinearFilter;
    this._seaTex.minFilter = THREE.LinearFilter;
    this._seaRegion = new THREE.Vector3(0, 0, 1 / SEA_REGION);
    this._seaCenter = new THREE.Vector2(Infinity, Infinity);

    const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uDeep: { value: this._deep.clone() },
      uShallow: { value: this._shallow.clone() },
      uSunDir: { value: this._sunDir.clone() },
      uSunCol: { value: this._sunCol.clone() },
      uRegion: { value: this._seaRegion },
    }]);
    uniforms.uDepthTex = { value: this._seaTex };
    const mat = new THREE.ShaderMaterial({
      vertexShader: SEA_VERT,
      fragmentShader: SEA_FRAG,
      uniforms,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this._sea = new THREE.Mesh(geo, mat);
    this._sea.frustumCulled = false;
    this._sea.position.y = this.field.seaY;
    this.group.add(this._sea);
  }

  _refreshSeaDepth(cx, cz) {
    const seaY = this.field.seaY;
    const x0 = cx - SEA_REGION / 2, z0 = cz - SEA_REGION / 2;
    const step = SEA_REGION / SEA_TEX;
    let k = 0;
    for (let j = 0; j < SEA_TEX; j++) {
      const wz = z0 + (j + 0.5) * step;
      for (let i = 0; i < SEA_TEX; i++) {
        const d = (seaY - this.field.height(x0 + (i + 0.5) * step, wz)) / 40;
        this._seaData[k++] = Math.max(0, Math.min(255, d * 255)) | 0;
      }
    }
    this._seaTex.needsUpdate = true;
    this._seaRegion.set(x0, z0, 1 / SEA_REGION);
    this._seaCenter.set(cx, cz);
  }

  _updateSea(dt, focusPos, sunDir, sunCol) {
    if (!this._sea) return;
    const u = this._sea.material.uniforms;
    u.uTime.value += dt;
    this._sea.position.set(focusPos.x, this.field.seaY, focusPos.z);
    if (Math.abs(focusPos.x - this._seaCenter.x) > 260 || Math.abs(focusPos.z - this._seaCenter.y) > 260) {
      this._refreshSeaDepth(focusPos.x, focusPos.z);
    }
    if (sunDir) this._sunDir.copy(sunDir).normalize();
    if (sunCol) this._sunCol.set(sunCol.r, sunCol.g, sunCol.b);
    else if (!sunDir && (this._sunScan-- <= 0)) this._scanSun();
    u.uSunDir.value.copy(this._sunDir);
    u.uSunCol.value.copy(this._sunCol);
  }

  // Integration fallback: mirror the scene's key directional light so the sea
  // spec matches the sky without an explicit wiring contract.
  _scanSun() {
    this._sunScan = 45;
    let found = null;
    this.scene.traverse((o) => { if (!found && o.isDirectionalLight) found = o; });
    if (found) {
      this._sunDir.copy(found.position).sub(found.target.position).normalize();
      const it = Math.min(found.intensity * 0.5, 2.2);
      this._sunCol.copy(found.color).multiplyScalar(Math.max(it, 0.15));
    }
  }

  // --------------------------------------------------------------- chunks
  _indexFor(lod) {
    if (this._indices[lod]) return this._indices[lod];
    const segs = LOD_SEGS[lod], n1 = segs + 1;
    const tris = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1;
        tris.push(a, c, b, b, c, d);
      }
    }
    // skirts: 4 edges, quads emitted with both windings (robust, no cull risk)
    const base = n1 * n1;
    const top = (e, k) => (e === 0 ? k : e === 1 ? k * n1 + segs : e === 2 ? segs * n1 + k : k * n1);
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < segs; k++) {
        const t0 = top(e, k), t1 = top(e, k + 1);
        const s0 = base + e * n1 + k, s1 = s0 + 1;
        tris.push(t0, t1, s0, t1, s1, s0, t0, s0, t1, t1, s0, s1);
      }
    }
    this._indices[lod] = new THREE.BufferAttribute(new Uint16Array(tris), 1);
    return this._indices[lod];
  }

  _acquireGeometry(lod) {
    const pooled = this._pool[lod].pop();
    if (pooled) return pooled;
    const segs = LOD_SEGS[lod];
    const vcount = (segs + 1) * (segs + 1) + 4 * (segs + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vcount * 3), 3));
    g.setIndex(this._indexFor(lod));
    return g;
  }

  _colorFor(out, h, ny, m, wx, wz) {
    const b = this._baseY, s = this._bandScale;
    if (h < b - 0.5) {
      // seabed: sand tinted toward deep water with depth
      const d01 = smooth01((b - h) / 26);
      out.copy(this._shore).lerp(this._shallow, 0.3 + 0.5 * d01).lerp(this._deep, d01 * 0.75);
    } else {
      const patch = 0.5 + 0.5 * this._nPatch.fbm2(wx / 43, wz / 43, 2);
      _lowC.copy(this._lowA).lerp(this._lowB, patch);
      _midC.copy(this._midA).lerp(this._midB, patch);
      const e1 = b + 14 * s, e2 = b + 35 * s, e3 = b + 57 * s, e4 = b + 74 * s;
      out.copy(this._shore);
      out.lerp(_lowC, smooth01((h - (b + 1.5)) / (9 * s)));
      out.lerp(_midC, smooth01((h - e1) / (e2 - e1)));
      out.lerp(this._high, smooth01((h - e2) / (e3 - e2)));
      out.lerp(this._peak, smooth01((h - e3) / (e4 - e3)));
      // moisture tint on the vegetated band
      const veg = smooth01((h - b) / 4) * (1 - smooth01((h - e2) / (e3 - e2)));
      out.lerp(this._wet, m * 0.4 * veg);
      out.lerp(this._dry, (1 - m) * 0.22 * veg);
    }
    // cliffs on steep slopes
    const slope = 1 - ny;
    out.lerp(this._cliff, smooth01((slope - 0.32) / 0.2) * (h > b - 2 ? 1 : 0.4));
    // snow caps settle on flat-ish ground above the snow line
    const sn = smooth01((h - this._snowY) / 9) * (1 - smooth01((slope - 0.25) / 0.25));
    if (sn > 0) out.lerp(this._snow, sn * 0.95);
    // noise dithering against banding: fine grain + a slightly hue-shifted
    // mid-scale mottle so close-up ground never reads as one flat wash
    const f = 1 + this._nDither.noise2D(wx * 0.31, wz * 0.31) * 0.08;
    const mot = this._nDither.noise2D(wx * 0.045 + 37.2, wz * 0.045 - 11.8) * 0.07;
    out.r = clamp01(out.r * (f + mot * 0.6));
    out.g = clamp01(out.g * (f + mot));
    out.b = clamp01(out.b * (f + mot * 0.3));
  }

  _buildChunk(cx, cz, lod) {
    const segs = LOD_SEGS[lod];
    const cell = CHUNK / segs;
    const g = segs + 3;
    const hs = this._scratch[lod];
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const field = this.field;
    for (let j = 0; j < g; j++) {
      const wz = oz + (j - 1) * cell;
      for (let i = 0; i < g; i++) hs[j * g + i] = field.height(ox + (i - 1) * cell, wz);
    }
    const geo = this._acquireGeometry(lod);
    const pos = geo.attributes.position.array;
    const nor = geo.attributes.normal.array;
    const col = geo.attributes.color.array;
    const n1 = segs + 1;
    const inv2c = 1 / (2 * cell);
    let vi = 0;
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n1; i++) {
        const gi = (j + 1) * g + (i + 1);
        const h = hs[gi];
        const nx = (hs[gi - 1] - hs[gi + 1]) * inv2c;
        const nz = (hs[gi - g] - hs[gi + g]) * inv2c;
        const inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
        const wx = ox + i * cell, wz = oz + j * cell;
        pos[vi] = i * cell; pos[vi + 1] = h; pos[vi + 2] = j * cell;
        nor[vi] = nx * inv; nor[vi + 1] = inv; nor[vi + 2] = nz * inv;
        this._colorFor(_c, h, inv, field.moisture(wx, wz), wx, wz);
        col[vi] = _c.r; col[vi + 1] = _c.g; col[vi + 2] = _c.b;
        vi += 3;
      }
    }
    // skirt ring: perimeter verts pushed down, colors/normals copied
    const skirt = 3 + cell * 1.4;
    const top = (e, k) => (e === 0 ? k : e === 1 ? k * n1 + segs : e === 2 ? segs * n1 + k : k * n1);
    let sv = n1 * n1;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < n1; k++) {
        const t3 = top(e, k) * 3, s3 = sv * 3;
        pos[s3] = pos[t3]; pos[s3 + 1] = pos[t3 + 1] - skirt; pos[s3 + 2] = pos[t3 + 2];
        nor[s3] = nor[t3]; nor[s3 + 1] = nor[t3 + 1]; nor[s3 + 2] = nor[t3 + 2];
        col[s3] = col[t3]; col[s3 + 1] = col[t3 + 1]; col[s3 + 2] = col[t3 + 2];
        sv++;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, this.material);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.castShadow = lod === 0;
    return mesh;
  }

  _releaseChunk(key, ch) {
    this.group.remove(ch.mesh);
    if (this._pool[ch.lod].length < POOL_MAX) this._pool[ch.lod].push(ch.mesh.geometry);
    else ch.mesh.geometry.dispose();
    this.chunks.delete(key);
  }

  _retarget() {
    const R = this.viewChunks;
    const keep = new Set();
    const wanted = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > R * R + R) continue;
        const cx = this._fx + dx, cz = this._fz + dz;
        const key = cx + ',' + cz;
        keep.add(key);
        const d = Math.sqrt(d2);
        const lod = d <= LOD_NEAR ? 0 : d <= LOD_MID ? 1 : 2;
        const cur = this.chunks.get(key);
        if (!cur || cur.lod !== lod) wanted.push({ cx, cz, lod, d, key });
      }
    }
    for (const [key, ch] of this.chunks) if (!keep.has(key)) this._releaseChunk(key, ch);
    wanted.sort((a, b) => a.d - b.d);
    this._queue = wanted;
  }

  /**
   * The heightfield changed inside this circle (Arcforge dig) — rebuild the
   * chunks that overlap it, front of the queue, same LODs.
   */
  invalidateArea(x, z, r) {
    const c0x = Math.floor((x - r) / CHUNK), c1x = Math.floor((x + r) / CHUNK);
    const c0z = Math.floor((z - r) / CHUNK), c1z = Math.floor((z + r) / CHUNK);
    const jobs = [];
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const key = cx + ',' + cz;
        const cur = this.chunks.get(key);
        if (!cur) continue;
        if (this._queue.some((j) => j.key === key)) continue;
        jobs.push({ cx, cz, lod: cur.lod, d: 0, key });
      }
    }
    this._queue.unshift(...jobs);
  }

  _processQueue(budgetMs) {
    const t0 = performance.now();
    while (this._queue.length) {
      const job = this._queue.shift();
      const old = this.chunks.get(job.key);
      if (old) this._releaseChunk(job.key, old);
      const mesh = this._buildChunk(job.cx, job.cz, job.lod);
      this.group.add(mesh);
      this.chunks.set(job.key, { mesh, lod: job.lod, cx: job.cx, cz: job.cz });
      if (performance.now() - t0 > budgetMs) break;
    }
  }

  /**
   * Stream chunks around focusPos and animate the sea.
   * @param {number} dt seconds
   * @param {THREE.Vector3} focusPos player/camera world position
   * @param {THREE.Vector3} [sunDir] optional direction toward the sun
   * @param {THREE.Color} [sunCol] optional HDR-ish sun color for sea spec
   */
  update(dt, focusPos, sunDir = null, sunCol = null) {
    const fx = Math.floor(focusPos.x / CHUNK), fz = Math.floor(focusPos.z / CHUNK);
    if (fx !== this._fx || fz !== this._fz || this._first) {
      this._fx = fx; this._fz = fz;
      this._retarget();
    }
    // first update blocks long enough to present a complete landscape;
    // afterwards builds are amortized across frames
    this._processQueue(this._first ? 4000 : 12);
    this._first = false;
    this._updateSea(dt, focusPos, sunDir, sunCol);
  }

  /** Remove and free every GPU resource this renderer owns. */
  dispose() {
    for (const [key, ch] of [...this.chunks]) {
      this.group.remove(ch.mesh);
      ch.mesh.geometry.dispose();
      this.chunks.delete(key);
    }
    for (const bucket of this._pool) {
      for (const g of bucket) g.dispose();
      bucket.length = 0;
    }
    this.material.dispose();
    this._detailTex.dispose();
    if (this._sea) {
      this.group.remove(this._sea);
      this._sea.geometry.dispose();
      this._sea.material.dispose();
      this._seaTex.dispose();
      this._sea = null;
    }
    this.scene.remove(this.group);
  }
}
