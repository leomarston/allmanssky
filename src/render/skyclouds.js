// SkyClouds — cinematic overhead cloudscape for the planet SURFACE sky.
//
// The bare SkyDome is a flat gradient — the biggest "cheap sky" tell. This adds
// up to 3 large inside-out cloud DOME shells (BackSide spheres re-centred on the
// camera every frame, so clouds are always overhead) whose fragment shader
// builds soft, animated cloud coverage from an analytic multi-octave value-noise
// FBM. It is sun-lit with a single-step light term (silvery rims toward the sun
// that feed bloom, darker cores), soft-thresholded coverage, a horizon melt into
// the atmosphere haze, and day/night dimming. It reads as volumetric without any
// raymarch loop — pure ALU, no texture fetches — so it renders reliably on
// Chromium SwiftShader (WebGL2) where true volumetrics are too costly.
//
// FOG NOTE: like SkyDome (sky.js), these domes use `fog: false` and melt into
// the horizon by blending toward the atmosphere's fog colour via a view-elevation
// fade. The surface FogExp2 (density ~0.001–0.003) evaluated at a camera-centred
// dome of radius ~2.5–3.2 km saturates to 1.0 overhead, which would erase the
// clouds entirely — so we reproduce the SkyDome's manual `uFog` blend instead of
// the standard fog chunk. Same visual result, controllable, SwiftShader-safe.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const toColor = (v, fb) => new THREE.Color(v ?? fb);

// Per-biome cloud character: altitude bias, shadow darkness (dark ash / mire
// undersides), and a cool tint push (icy worlds). Coverage + base colour come
// from PlanetDef.clouds (already biome-art-directed in biomes.js).
const BIOME = {
  lush:       { altBias: 0.85, dark: 1.00, cool: 0.00 },
  ocean:      { altBias: 0.95, dark: 1.00, cool: 0.05 },
  swamp:      { altBias: 0.75, dark: 0.70, cool: 0.00 },
  toxic:      { altBias: 0.85, dark: 0.70, cool: 0.00 },
  frozen:     { altBias: 1.25, dark: 1.00, cool: 0.28 },
  desert:     { altBias: 1.35, dark: 1.00, cool: 0.00 },
  volcanic:   { altBias: 1.00, dark: 0.48, cool: 0.00 },
  irradiated: { altBias: 1.20, dark: 0.85, cool: 0.05 },
  crystal:    { altBias: 1.40, dark: 1.00, cool: 0.18 },
  barren:     { altBias: 1.30, dark: 0.90, cool: 0.12 },
  exotic:     { altBias: 1.00, dark: 0.90, cool: 0.00 },
};

const CLOUD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vDir;
void main() {
  // Mesh is only translated (to camPos) and uniformly scaled (to radius), never
  // rotated — so object-space position is the world view direction from the eye.
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uTime;
uniform vec3  uSunDir;
uniform vec2  uCamXZ;
uniform vec2  uWind;
uniform float uFreq;
uniform float uPlaneH;
uniform float uCovLo;
uniform float uCovHi;
uniform float uOpacity;
uniform float uDay;
uniform float uWarp;
uniform float uDetail;
uniform float uRim;
uniform vec3  uLitCol;
uniform vec3  uShadowCol;
uniform vec3  uSunTint;
uniform vec3  uHorizonCol;
uniform vec3  uHorizonColN;
varying vec3 vDir;

// --- analytic value-noise FBM (no texture fetch, ALU only) ------------------
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 M2 = mat2(1.62, 1.18, -1.18, 1.62); // rotate+scale between octaves
float fbm4(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = M2 * p; a *= 0.5; }
  return s * 1.0667; // normalise sum(a)=0.9375 → ~[0,1]
}
float fbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 2; i++) { s += a * vnoise(p); p = M2 * p; a *= 0.5; }
  return s * 1.3333; // sum(a)=0.75 → ~[0,1]
}
// Domain-warped billowy density field in ~[0,1].
float density(vec2 p) {
  vec2 q = vec2(fbm2(p * 0.5 + 11.3), fbm2(p * 0.5 + 47.7)) - 0.5;
  return fbm4(p + uWarp * q);
}

void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  float h = dir.y;
  if (h < 0.015) discard; // below horizon: skip the sphere's lower hemisphere

  // Project the view ray onto a flat cloud plane at height uPlaneH: features
  // crowd toward the horizon (real perspective) and parallax with world position.
  float t = uPlaneH / max(h, 0.10);
  vec2 p = (uCamXZ + dir.xz * t) * uFreq + uWind * uTime;

  float d = density(p);
  float covLo = uCovLo + 0.03 * sin(uTime * 0.05);   // slow coverage breathing
  float cov = smoothstep(covLo, uCovHi, d);
  if (cov < 0.004) discard;                           // clear sky: skip lighting
  float det = fbm2(p * 3.1 + uWind * uTime * 1.7);    // erode edges into wisps
  cov *= mix(1.0 - uDetail, 1.0, det);

  // Cheap single-step light: compare density here vs one step toward the sun.
  // Edges facing the sun are lifted (silver), thick cores stay dark.
  vec2 sdir = normalize(uSunDir.xz + vec2(1e-4));
  float dS = density(p + sdir * (uFreq * uPlaneH * 0.9));
  float lift = clamp((d - dS) * 3.2, -1.0, 1.0);
  float lightF = clamp(0.5 + 0.5 * lift, 0.0, 1.0);
  vec3 col = mix(uShadowCol, uLitCol, lightF);

  // Forward-scattered silver rim toward the sun — HDR (>1) so bloom catches it.
  float sun = max(dot(dir, uSunDir), 0.0);
  float edge = clamp(cov * (1.0 - cov) * 4.0, 0.0, 1.0);     // bright at soft edges
  float rim = pow(sun, 5.0) * edge * (0.5 + 0.5 * max(lift, 0.0));
  float glow = rim * uRim * uDay;
  col += uSunTint * glow;
  col *= 1.0 + 0.22 * pow(sun, 2.0) * uDay;                   // warm the sunward sky

  // Day/night grade: dim + cool toward night.
  col *= mix(0.16, 1.0, uDay);
  col = mix(col, col * vec3(0.48, 0.60, 0.92), (1.0 - uDay) * 0.7);

  // Melt into the atmosphere haze at the horizon (matches SkyDome's uFog blend).
  vec3 fogc = mix(uHorizonColN, uHorizonCol, uDay);
  col = mix(fogc, col, smoothstep(0.02, 0.30, h));

  float alpha = cov * uOpacity * smoothstep(0.02, 0.16, h);
  alpha = clamp(alpha + glow * 0.10, 0.0, 1.0);               // keep the bright rim
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Layered procedural cloud dome for the planet surface sky.
 *
 * @example
 *   this.skyClouds = new SkyClouds(scene, def);
 *   // per frame:
 *   this.skyClouds.update(dt, camera.position, sky.sunDir, dayFactor);
 *   // teardown:
 *   this.skyClouds.dispose();
 */
export class SkyClouds {
  /**
   * @param {THREE.Scene} scene
   * @param {object} def PlanetDef (uses .biome, .atmosphere, .clouds, .seed)
   * @param {{maxLayers?:number, segments?:number}} [opts]
   */
  constructor(scene, def, opts = {}) {
    this.scene = scene;
    this.def = def;
    this.layers = [];
    this._time = 0;

    const atmo = def.atmosphere ?? {};
    const density = clamp(atmo.density ?? 0.3, 0, 1);
    const bio = BIOME[def.biome] ?? BIOME.exotic;
    const cov = def.clouds ? clamp(def.clouds.coverage ?? 0.5, 0, 1) : 0;

    // Layer count scales with coverage; barren / near-vacuum worlds get none.
    let n;
    if (cov < 0.06 || density < 0.12) n = 0;
    else if (cov < 0.28) n = 1;
    else if (cov < 0.6) n = 2;
    else n = 3;
    n = Math.min(n, opts.maxLayers ?? 3);
    if (n === 0) return; // clear-sky world: nothing to build, update/dispose no-op

    const seed = (def.seed ?? hashString(String(def.id ?? 'planet'))) >>> 0;
    const rng = new RNG(hash32(seed, 0x5c10));

    // Palette (built once — no per-frame colour math).
    const base = def.clouds
      ? toColor(def.clouds.colorHex, '#e8eef6')
      : toColor(atmo.colorHex, '#cfdcea').lerp(new THREE.Color(1, 1, 1), 0.4);
    const white = new THREE.Color(1, 1, 1);
    const litCol = base.clone().lerp(white, 0.5);
    if (bio.cool > 0) litCol.lerp(new THREE.Color(0.62, 0.72, 1.0), bio.cool);
    const shadowCol = base.clone().multiplyScalar(0.42 * bio.dark)
      .lerp(new THREE.Color(0.10, 0.13, 0.22), 0.40);
    const sunTint = new THREE.Color(1.0, 0.94, 0.82);
    const horizonCol = toColor(atmo.fogColorHex, '#c0d2df');
    const horizonColN = horizonCol.clone().multiplyScalar(0.05)
      .lerp(new THREE.Color('#0a0e18'), 0.5);

    const baseOpacity = clamp(0.6 + 0.45 * density, 0.5, 1.0);
    const alt0 = 480 * bio.altBias;
    const seg = opts.segments ?? 32;
    // One shared unit-sphere geometry; radius comes from per-mesh scale.
    this._geo = new THREE.SphereGeometry(1, seg, Math.max(12, seg >> 1));

    const LAYER_OP = [1.0, 0.68, 0.46];
    for (let i = 0; i < n; i++) {
      const radius = 2500 + i * 330;                 // all < SkyDome's 3600
      const planeH = alt0 * (1 + 0.55 * i);
      const freq = 0.0019 * (1 + 0.7 * i);
      const covLo = clamp(THREE.MathUtils.lerp(0.62, 0.32, cov) + 0.05 * i, 0.05, 0.9);
      const covHi = covLo + THREE.MathUtils.lerp(0.22, 0.12, cov);
      const wAng = rng.range(0, Math.PI * 2);
      const wSpd = rng.range(0.02, 0.05);

      const mat = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uCamXZ: { value: new THREE.Vector2(0, 0) },
          uWind: { value: new THREE.Vector2(Math.cos(wAng) * wSpd, Math.sin(wAng) * wSpd) },
          uFreq: { value: freq },
          uPlaneH: { value: planeH },
          uCovLo: { value: covLo },
          uCovHi: { value: covHi },
          uOpacity: { value: baseOpacity * LAYER_OP[i] },
          uDay: { value: 1 },
          uWarp: { value: rng.range(0.7, 1.1) },
          uDetail: { value: 0.35 },
          uRim: { value: 2.0 },
          uLitCol: { value: litCol.clone() },
          uShadowCol: { value: shadowCol.clone() },
          uSunTint: { value: sunTint.clone() },
          uHorizonCol: { value: horizonCol.clone() },
          uHorizonColN: { value: horizonColN.clone() },
        },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false, // see FOG NOTE at top — we melt into uHorizon* manually
      });

      const mesh = new THREE.Mesh(this._geo, mat);
      mesh.scale.setScalar(radius);
      mesh.name = 'skyclouds';
      mesh.frustumCulled = false;
      mesh.renderOrder = -90 + (n - 1 - i); // after SkyDome(-100); far shell first
      scene.add(mesh);
      this.layers.push({ mesh, mat });
    }
  }

  /**
   * Advance clouds. Re-centres the domes on the camera (always overhead),
   * scrolls/animates via uTime, tracks the sun, and dims for night.
   * @param {number} dt seconds
   * @param {THREE.Vector3} camPos
   * @param {THREE.Vector3} sunDir unit vector toward the sun (sky.sunDir)
   * @param {number} dayFactor 0 (deep night) → 1 (full day)
   */
  update(dt, camPos, sunDir, dayFactor) {
    this._time += dt;
    const day = clamp(dayFactor ?? 1, 0, 1);
    for (const L of this.layers) {
      const u = L.mat.uniforms;
      u.uTime.value = this._time;
      u.uDay.value = day;
      if (sunDir) u.uSunDir.value.copy(sunDir);
      if (camPos) {
        u.uCamXZ.value.set(camPos.x, camPos.z);
        L.mesh.position.copy(camPos);
      }
    }
  }

  /** Remove the domes and release GPU resources. */
  dispose() {
    for (const L of this.layers) {
      this.scene.remove(L.mesh);
      L.mat.dispose();
    }
    this._geo?.dispose();
    this.layers = [];
  }
}
