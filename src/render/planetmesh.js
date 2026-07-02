// From-space planet visual: a seeded 3D-simplex-fbm terrain shader paints
// continents, oceans, ice caps and biome styling (volcanic lava veins,
// crystal/exotic banding) from the planet's palette, with day/night lighting,
// ocean sun-glint, atmospheric limb haze and optional night-side city glow.
// Composes the atmosphere / cloud / ring sibling modules into one group.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { createAtmosphere } from './atmosphere.js';
import { createCloudLayer } from './clouds.js';
import { createRings } from './rings.js';

// ---------------------------------------------------------------------------
// GLSL: Ashima/webgl-noise 3D simplex (public domain style, MIT) + fractals.
const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, norm = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * snoise(p);
    norm += a;
    p = p * 2.07 + vec3(19.19);
    a *= 0.5;
  }
  return s / norm;
}
float ridge(vec3 p) {
  float s = 0.0, a = 0.55, prev = 1.0;
  for (int i = 0; i < 4; i++) {
    float n = 1.0 - abs(snoise(p));
    n *= n;
    s += n * a * prev;
    prev = n;
    p = p * 2.13 + vec3(7.7);
    a *= 0.5;
  }
  return s;
}
`;

// Shared terrain field — identical in vertex (silhouette displacement) and
// fragment (coloring/bump) so the two always agree.
const TERRAIN_GLSL = /* glsl */ `
uniform vec3 uSeedOffset;
uniform float uContFreq;
uniform float uWarpAmt;
uniform float uRidgeAmt;
uniform float uSea;
${NOISE_GLSL}
// Terrain height in [0,1] for a unit-sphere direction; also outputs the
// warped sample point (wp) and a slow moisture proxy for tint variation.
float heightAt(vec3 dir, out vec3 wp, out float moist) {
  vec3 sp = dir * uContFreq + uSeedOffset;
  float w1 = fbm(sp * 0.8 + vec3(17.3, 9.1, 4.7), 3);
  float w2 = fbm(sp * 0.8 + vec3(-11.1, 23.7, -7.9), 3);
  wp = sp + uWarpAmt * vec3(w1, w2, (w1 - w2) * 0.75);
  float cont = fbm(wp, 5);
  float h = cont * 0.62 + 0.5;
  h += ridge(wp * 2.6 + vec3(5.0)) * uRidgeAmt * 0.24
     * smoothstep(uSea - 0.05, uSea + 0.28, h);
  moist = w2 * 0.5 + 0.5;
  return clamp(h, 0.0, 1.0);
}
`;

const PLANET_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
uniform float uDispAmt;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${TERRAIN_GLSL}
void main() {
  vObj = normalize(position);
  vec3 wp; float m;
  float h = heightAt(vObj, wp, m);
  float land = max(h - max(uSea, 0.08), 0.0);
  vec3 posObj = position * (1.0 + land * uDispAmt);
  vec4 worldPos = modelMatrix * vec4(posObj, 1.0);
  vWorldPos = worldPos.xyz;
  vNormalW = normalize(mat3(modelMatrix) * vObj);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
  #include <logdepthbuf_vertex>
}
`;

const PLANET_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uIceLat;
uniform float uSnowLine;
uniform float uLavaAmt;
uniform float uBandAmt;
uniform float uBandFreq;
uniform float uCityAmt;
uniform float uAtmoDensity;
uniform vec3 uAtmoColor;
uniform float uBumpAmt;
uniform vec3 uCDeep;
uniform vec3 uCShallow;
uniform vec3 uCShore;
uniform vec3 uCLow;
uniform vec3 uCMid;
uniform vec3 uCHigh;
uniform vec3 uCPeak;
uniform vec3 uCCliff;
uniform vec3 uCAccent;
uniform vec3 uCGlow;
varying vec3 vObj;
varying vec3 vNormalW;
varying vec3 vWorldPos;
${TERRAIN_GLSL}
void main() {
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 sphN = normalize(vNormalW);
  vec3 dirN = normalize(vObj);

  vec3 wp; float moist;
  float h = heightAt(dirN, wp, moist);
  float water = 1.0 - smoothstep(uSea - 0.004, uSea + 0.004, h);
  float t = clamp((h - uSea) / max(1.0 - uSea, 1e-3), 0.0, 1.0);

  // --- bump normal from screen-space derivatives of the height field -------
  float hb = max(h, uSea) * uBumpAmt;      // seas stay glassy-flat
  vec3 dpx = dFdx(vWorldPos);
  vec3 dpy = dFdy(vWorldPos);
  vec3 r1 = cross(dpy, sphN);
  vec3 r2 = cross(sphN, dpx);
  float det = dot(dpx, r1);
  float fade = smoothstep(0.05, 0.3, dot(sphN, V)); // stabilise the limb
  vec3 grad = sign(det) * (dFdx(hb) * r1 + dFdy(hb) * r2) * fade;
  vec3 N = normalize(abs(det) * sphN - grad);

  // --- albedo ---------------------------------------------------------------
  float depth01 = clamp((uSea - h) / max(uSea, 1e-3), 0.0, 1.0);
  vec3 waterCol = mix(uCShallow, uCDeep, smoothstep(0.015, 0.5, depth01));

  vec3 landCol = mix(uCShore, uCLow, smoothstep(0.015, 0.09, t));
  landCol = mix(landCol, uCMid, smoothstep(0.2, 0.46, t));
  landCol = mix(landCol, uCHigh, smoothstep(0.46, 0.7, t));
  landCol = mix(landCol, uCPeak, smoothstep(0.7, 0.88, t));
  // moisture pushes lowlands toward the accent hue for painterly variety
  landCol = mix(landCol, uCAccent, smoothstep(0.55, 0.95, moist) * (1.0 - t) * 0.28);
  // cliffs where the bumped normal breaks from the sphere
  float slope = clamp(1.0 - dot(N, sphN) * fade - (1.0 - fade), 0.0, 1.0);
  landCol = mix(landCol, uCCliff, smoothstep(0.1, 0.32, slope) * 0.7);

  // stylised banding (crystal / exotic biomes)
  if (uBandAmt > 0.001) {
    float bandN = fbm(wp * 1.7 + vec3(3.7), 3);
    float band = sin((dirN.y * 2.4 + bandN * 0.9 + h * 1.2) * uBandFreq);
    float bs = smoothstep(0.1, 0.85, band * 0.5 + 0.5);
    landCol = mix(landCol, uCAccent, uBandAmt * bs * 0.55);
    landCol = mix(landCol, uCDeep, uBandAmt * (1.0 - bs) * 0.25);
  }

  vec3 albedo = mix(landCol, waterCol, water);

  // polar ice caps + altitude snow (cold worlds)
  float lat = abs(dirN.y);
  float iceN = snoise(dirN * 8.0 + uSeedOffset * 1.31) * 0.07;
  float ice = smoothstep(uIceLat, uIceLat + 0.09, lat + iceN + t * 0.05);
  float snow = smoothstep(uSnowLine, uSnowLine + 0.09, t + iceN * 0.6) * (1.0 - water);
  float frost = clamp(ice + snow, 0.0, 1.0);
  vec3 iceCol = mix(vec3(0.75, 0.82, 0.9), vec3(0.98), smoothstep(0.2, 0.95, lat + iceN));
  albedo = mix(albedo, iceCol, frost * 0.97);

  // volcanic lava veins (HDR emissive)
  float vein = 0.0;
  if (uLavaAmt > 0.001) {
    float v1 = 1.0 - abs(snoise(wp * 2.9));
    float v2 = 1.0 - abs(snoise(wp * 6.7 + vec3(31.7)));
    vein = pow(clamp(v1 * 0.62 + v2 * 0.55 - 0.3, 0.0, 1.0), 4.0);
    vein *= uLavaAmt * smoothstep(0.62, 0.28, t) * (1.0 - frost) * (1.0 - water);
    albedo = mix(albedo, uCAccent, clamp(vein * 2.6, 0.0, 1.0) * 0.6);
    albedo *= 1.0 - uLavaAmt * 0.25; // scorched rock reads darker
  }

  // --- lighting --------------------------------------------------------------
  float ndl = dot(N, uSunDir);
  float sphNdl = dot(sphN, uSunDir);
  float diff = clamp(ndl, 0.0, 1.0);
  float dayMask = smoothstep(-0.03, 0.16, sphNdl);

  // warm sunset tint hugging the terminator, stronger with thicker air
  float term = (1.0 - smoothstep(0.0, 0.34, abs(sphNdl))) * uAtmoDensity;
  vec3 sunTint = mix(uSunColor, uSunColor * vec3(1.3, 0.6, 0.35), term * 0.8);

  vec3 col = albedo * diff * sunTint;

  // ocean sun glint
  float glint = pow(clamp(dot(reflect(-uSunDir, N), V), 0.0, 1.0), 130.0);
  col += sunTint * glint * water * (1.0 - frost * 0.7) * 1.7 * smoothstep(0.02, 0.2, diff);

  // atmospheric limb haze over the lit disc
  float mu = clamp(dot(sphN, V), 0.0, 1.0);
  float haze = pow(1.0 - mu, 2.4) * uAtmoDensity;
  col += uAtmoColor * haze * (0.04 + 0.62 * clamp(sphNdl, 0.0, 1.0));

  // night side: near-black with a whisper of albedo…
  col += albedo * 0.012 * (1.0 - dayMask) * (0.35 + 0.65 * mu);

  // …and, on inhabited seeds, emissive settlement speckles near the terminator
  if (uCityAmt > 0.001) {
    float cn = snoise(dirN * 56.0 + uSeedOffset * 2.13);
    float cn2 = snoise(dirN * 170.0 - uSeedOffset * 1.7);
    float cities = smoothstep(0.52, 0.92, cn) * smoothstep(0.15, 0.75, cn2 * 0.5 + 0.5);
    float coast = 1.0 - smoothstep(0.02, 0.34, t);
    cities *= (1.0 - water) * (1.0 - frost) * (0.3 + 0.7 * coast);
    float termGlow = 1.0 - smoothstep(0.0, 0.55, abs(sphNdl));
    col += uCGlow * cities * uCityAmt * (1.0 - dayMask) * (0.35 + 0.65 * termGlow) * 2.6;
  }

  // lava glows day and night, breathing slowly (HDR feeds bloom)
  if (uLavaAmt > 0.001) {
    float pulse = 0.85 + 0.25 * snoise(vec3(dirN.xz * 3.0, uTime * 0.13));
    col += uCGlow * vein * pulse * 3.4;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------

function paletteColor(palette, key, fallback) {
  const v = palette?.[key];
  return new THREE.Color(v ?? fallback);
}

const clamp01 = (v) => THREE.MathUtils.clamp(v ?? 0, 0, 1);

/**
 * Build the complete from-space visual for a planet: terrain-shaded sphere
 * plus (per def) atmosphere shell, cloud layer and rings, all parented under
 * one group with the axial tilt applied. Fully deterministic from `def.seed`.
 *
 * @param {object} def `PlanetDef` (see ARCHITECTURE.md): uses `seed`, `biome`,
 *          `radius`, `seaLevel`, `axialTilt`, `dayLength`, `hazard`, `palette`,
 *          `atmosphere`, `clouds`, `rings`, `terrain`.
 * @param {object} [opts]
 * @param {number} [opts.segments=96] sphere resolution (64–96)
 * @param {number|string|THREE.Color} [opts.sunColor] key-light tint (default warm white)
 * @returns {{group: THREE.Group,
 *           update(dt:number, cameraPos?:THREE.Vector3, sunDir?:THREE.Vector3):void,
 *           dispose():void}}
 *   `sunDir` is a world-space unit vector from the planet toward the sun.
 */
export function createPlanetVisual(def, opts = {}) {
  const radius = def?.radius > 0 ? def.radius : 60;
  const seed = (def?.seed ?? hashString(String(def?.id ?? 'planet'))) >>> 0;
  const rng = new RNG(seed);
  const biome = def?.biome ?? 'barren';
  const terrain = def?.terrain ?? {};
  const hazard = def?.hazard ?? {};
  const palette = def?.palette;
  const segments = THREE.MathUtils.clamp(opts.segments ?? 96, 64, 96);

  // --- biome → shader parameterisation --------------------------------------
  const relief = clamp01(terrain.relief ?? 0.5);
  const roughness = clamp01(terrain.roughness ?? 0.5);
  const warp = clamp01(terrain.warp ?? 0.5);
  const cold = clamp01(hazard.cold ?? (biome === 'frozen' ? 0.9 : 0));
  const heat = clamp01(hazard.heat ?? (biome === 'volcanic' ? 0.9 : 0));

  let sea = clamp01((def?.seaLevel ?? 0) / 0.45) * 0.58;
  if (biome === 'ocean') sea = Math.max(sea, 0.62);
  const lavaAmt = biome === 'volcanic' ? 0.75 + 0.25 * heat : 0;
  const isBanded = biome === 'crystal' || biome === 'exotic';
  const bandAmt = isBanded ? rng.range(0.75, 1) : 0;
  const bandFreq = biome === 'exotic' ? rng.range(9, 14) : rng.range(4, 7);
  // ice caps by |latitude| on cold worlds; hot/banded worlds get none
  let iceLat = 0.94 - cold * 0.62;
  if (heat > 0.35 || isBanded) iceLat = 1.6;
  const snowLine = 0.96 - cold * 0.5;
  // some seeds carry faint settlements along the night-side terminator
  const cityOk = !isBanded && lavaAmt === 0 && biome !== 'frozen';
  const cityAmt = cityOk && rng.chance(0.45) ? rng.range(0.55, 1) : 0;

  const atmoDensity = clamp01(def?.atmosphere?.density);
  const atmoColor = new THREE.Color(def?.atmosphere?.colorHex ?? 0x88bbff);
  const sunColor = new THREE.Color(opts.sunColor ?? 0xfff0dc);

  // --- planet surface --------------------------------------------------------
  const mat = new THREE.ShaderMaterial({
    vertexShader: PLANET_VERT,
    fragmentShader: PLANET_FRAG,
    uniforms: {
      uSeedOffset: { value: new THREE.Vector3(rng.range(-64, 64), rng.range(-64, 64), rng.range(-64, 64)) },
      uContFreq: { value: 1.5 + roughness * 1.3 },
      uWarpAmt: { value: 0.5 + warp * 1.1 },
      uRidgeAmt: { value: 0.45 + roughness * 0.8 },
      uSea: { value: sea },
      uDispAmt: { value: 0.012 + relief * 0.022 },
      uBumpAmt: { value: radius * (0.028 + 0.05 * relief) },
      uSunDir: { value: new THREE.Vector3(1, 0.2, 0.3).normalize() },
      uSunColor: { value: sunColor },
      uTime: { value: rng.range(0, 100) },
      uIceLat: { value: iceLat },
      uSnowLine: { value: snowLine },
      uLavaAmt: { value: lavaAmt },
      uBandAmt: { value: bandAmt },
      uBandFreq: { value: bandFreq },
      uCityAmt: { value: cityAmt },
      uAtmoDensity: { value: atmoDensity },
      uAtmoColor: { value: atmoColor },
      uCDeep: { value: paletteColor(palette, 'deepWater', 0x0b2e5f) },
      uCShallow: { value: paletteColor(palette, 'shallowWater', 0x1b6aa8) },
      uCShore: { value: paletteColor(palette, 'shore', 0xd8c58b) },
      uCLow: { value: paletteColor(palette, 'low', 0x3e8a4a) },
      uCMid: { value: paletteColor(palette, 'mid', 0x2f6b38) },
      uCHigh: { value: paletteColor(palette, 'high', 0x6e6650) },
      uCPeak: { value: paletteColor(palette, 'peak', 0xe8e8ea) },
      uCCliff: { value: paletteColor(palette, 'cliff', 0x5a5148) },
      uCAccent: { value: paletteColor(palette, 'accent', 0x8fd06a) },
      uCGlow: { value: paletteColor(palette, 'glow', 0xffd88a) },
    },
  });

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, segments, Math.round(segments * 0.7)), mat);
  mesh.name = `planet:${def?.id ?? seed}`;
  mesh.rotation.y = rng.range(0, Math.PI * 2);

  const group = new THREE.Group();
  group.name = `planetVisual:${def?.id ?? seed}`;
  group.rotation.z = def?.axialTilt ?? 0;
  group.add(mesh);

  // --- companions ------------------------------------------------------------
  /** sub-visuals sharing the tilted frame; each gets update(dt, sunDir) */
  const parts = [];
  if (atmoDensity > 0.04) {
    const atmo = createAtmosphere(radius, def.atmosphere);
    group.add(atmo.object3d);
    parts.push(atmo);
  }
  if (def?.clouds && clamp01(def.clouds.coverage) > 0.04) {
    const clouds = createCloudLayer(radius, def.clouds, hash32(seed, hashString('clouds')));
    group.add(clouds.object3d);
    parts.push(clouds);
  }
  if (def?.rings) {
    const rings = createRings(def.rings, hash32(seed, hashString('rings')), radius);
    group.add(rings.object3d);
    parts.push(rings);
  }

  // gentle time-lapse spin so day/night creeps visibly from space
  const spinRate = (Math.PI * 2 / Math.max(def?.dayLength ?? 600, 60)) * 6;
  const sunDirW = mat.uniforms.uSunDir.value.clone();

  return {
    group,

    /**
     * Advance rotation and drive all shaders.
     * @param {number} dt seconds
     * @param {THREE.Vector3} [cameraPos] camera world position (reserved; the
     *        shaders use the built-in `cameraPosition` uniform)
     * @param {THREE.Vector3} [sunDir] world-space unit vector toward the sun
     */
    update(dt, cameraPos, sunDir) {
      mat.uniforms.uTime.value += dt;
      mesh.rotation.y += spinRate * dt;
      if (sunDir) {
        sunDirW.copy(sunDir).normalize();
        mat.uniforms.uSunDir.value.copy(sunDirW);
      }
      for (const p of parts) p.update(dt, sunDirW);
    },

    /** Release all GPU resources and detach from the scene graph. */
    dispose() {
      group.removeFromParent();
      mesh.geometry.dispose();
      mat.dispose();
      for (const p of parts) p.dispose();
    },
  };
}
