// SkyDome — planet surface sky: inverted gradient dome (day/sunset/night from
// the planet's atmosphere colors), HDR sun disc + halo that feeds bloom, a
// procedural star canvas revealed at night, and the surface lighting rig
// (.light directional w/ shadows following the sun, .ambient hemisphere).
// Keeps scene.fog (FogExp2) synced to the horizon so terrain melts into sky.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';

const DOME_RADIUS = 3600;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smooth01(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
function toColor(v, fallback) { return new THREE.Color(v ?? fallback); }

const SKY_VERT = /* glsl */ `
#include <common>
varying vec3 vDir;
#include <logdepthbuf_pars_vertex>
void main() {
  vDir = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uZenithN;
uniform vec3 uHorizonN;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uSunsetCol;
uniform float uDay;
uniform float uNight;
uniform float uSunset;
uniform float uHaze;
uniform sampler2D uStars;
varying vec3 vDir;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec3 dir = normalize(vDir);
  float elev = dir.y;
  float he = max(elev, 0.0);

  // day gradient + haze band thickening near the horizon
  vec3 day = mix(uHorizon, uZenith, pow(he, 0.5 + 0.3 * uHaze));
  day = mix(day, uHorizon, exp(-he * (10.0 - 6.0 * uHaze)) * (0.3 + 0.55 * uHaze));
  vec3 night = mix(uHorizonN, uZenithN, pow(he, 0.65));
  vec3 sky = mix(night, day, uDay);

  // warm sunset ring hugging the horizon, strongest toward the sun azimuth
  vec2 dxz = normalize(dir.xz + vec2(1e-5));
  vec2 sxz = normalize(uSunDir.xz + vec2(1e-5));
  float az = max(dot(dxz, sxz), 0.0);
  sky += uSunsetCol * (uSunset * exp(-abs(elev - 0.015) * 6.5) * (0.2 + 0.8 * az * az * az));

  // stars fade in at night, hidden inside the horizon haze
  vec2 suv = vec2(atan(dir.z, dir.x) * 0.15915494 + 0.5,
                  asin(clamp(dir.y, -1.0, 1.0)) * 0.31830988 + 0.5);
  sky += texture2D(uStars, suv).rgb * (uNight * smoothstep(0.02, 0.18, elev) * (1.0 - 0.5 * uHaze));

  // sun disc (HDR, feeds bloom) + tight and wide halos
  float c = dot(dir, uSunDir);
  float disc = smoothstep(0.99962, 0.99987, c);
  float halo = pow(max(c, 0.0), 800.0) * 1.6 + pow(max(c, 0.0), 48.0) * (0.15 + 0.45 * uHaze);
  float sunVis = clamp(uDay + uSunset * 0.6, 0.0, 1.0);
  sky += uSunCol * (disc * 5.0 + halo) * sunVis;

  // below the horizon the dome equals the fog color → seamless terrain edge
  sky = mix(sky, uFog, smoothstep(0.015, -0.06, elev));
  gl_FragColor = vec4(sky, 1.0);
}
`;

function makeStarTexture(rng) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, c.width, c.height);
  // faint galaxy band arcing across the sky
  for (let i = 0; i < 54; i++) {
    const bx = rng.range(0, 1024);
    const by = 256 + Math.sin(bx * 0.006 + 1.3) * 72 + rng.gaussian(0, 26);
    const r = rng.range(18, 62);
    const grad = ctx.createRadialGradient(bx, by, 0, bx, by, r);
    const a = rng.range(0.02, 0.05);
    grad.addColorStop(0, `rgba(150,172,222,${a})`);
    grad.addColorStop(1, 'rgba(150,172,222,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(bx - r, by - r, r * 2, r * 2);
  }
  const tints = ['255,255,255', '208,224,255', '255,236,206', '198,240,255'];
  for (let i = 0; i < 1150; i++) {
    const x = rng.range(0, 1024), y = rng.range(0, 512);
    const r = rng.range(0.3, 1.3);
    ctx.fillStyle = `rgba(${rng.pick(tints)},${rng.range(0.25, 1).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  return tex;
}

/**
 * Sky + lighting rig for the planet surface scene.
 * Exposes .sunDir (THREE.Vector3 toward the sun), .light (shadow-casting
 * DirectionalLight that follows the sun) and .ambient (HemisphereLight).
 */
export class SkyDome {
  /**
   * @param {THREE.Scene} scene
   * @param {object} def PlanetDef
   */
  constructor(scene, def) {
    this.scene = scene;
    this.def = def;
    const seed = (def.seed ?? hashString(String(def.id ?? 'planet'))) >>> 0;
    const rng = new RNG(hash32(seed, 777));
    const atmo = def.atmosphere ?? {};
    this._density = clamp(atmo.density ?? 0.3, 0, 1);

    // palette
    this._zenith = toColor(atmo.skyColorHex, '#48719c');
    this._horizonDay = toColor(atmo.fogColorHex, '#c0d2df');
    const atmoCol = toColor(atmo.colorHex, '#9fc8e8');
    this._zenithN = this._zenith.clone().multiplyScalar(0.022).lerp(new THREE.Color('#05070f'), 0.5);
    this._horizonN = this._horizonDay.clone().multiplyScalar(0.05).lerp(new THREE.Color('#0a0e18'), 0.5);
    this._sunsetCol = new THREE.Color(1.0, 0.42, 0.16).lerp(atmoCol, 0.22);
    this._sunColDay = new THREE.Color(1.0, 0.96, 0.88);
    this._sunColLow = new THREE.Color(1.0, 0.55, 0.24);
    this._fogColor = this._horizonDay.clone();

    /** @type {THREE.Vector3} unit vector pointing toward the sun */
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this._azimuth = rng.range(0, Math.PI * 2);

    // dome
    this._starTex = makeStarTexture(rng);
    this._uniforms = {
      uZenith: { value: this._zenith.clone() },
      uHorizon: { value: this._horizonDay.clone() },
      uZenithN: { value: this._zenithN },
      uHorizonN: { value: this._horizonN },
      uFog: { value: this._fogColor.clone() },
      uSunDir: { value: this.sunDir.clone() },
      uSunCol: { value: new THREE.Color(1, 0.95, 0.85) },
      uSunsetCol: { value: this._sunsetCol },
      uDay: { value: 1 },
      uNight: { value: 0 },
      uSunset: { value: 0 },
      uHaze: { value: this._density },
      uStars: { value: this._starTex },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(DOME_RADIUS, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: this._uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    this.dome.name = 'skydome';
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -100;
    scene.add(this.dome);

    // key light (sun) with shadows configured for a ~300 m gameplay bubble
    /** @type {THREE.DirectionalLight} */
    this.light = new THREE.DirectionalLight(0xffffff, 4.2);
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    const sc = this.light.shadow.camera;
    sc.near = 40; sc.far = 1100;
    sc.left = -160; sc.right = 160; sc.top = 160; sc.bottom = -160;
    this.light.shadow.bias = -0.0005;
    this.light.shadow.normalBias = 2.0;
    scene.add(this.light);
    scene.add(this.light.target);

    // hemisphere fill tinted by sky above / ground palette below
    const groundCol = toColor(def.palette?.low, '#6b6a55').lerp(toColor(def.palette?.shore, '#8d8468'), 0.35);
    /** @type {THREE.HemisphereLight} */
    this.ambient = new THREE.HemisphereLight(this._zenith.clone().lerp(new THREE.Color(1, 1, 1), 0.2), groundCol, 0.8);
    scene.add(this.ambient);

    // exponential fog, density scaled by atmosphere thickness
    this._fogDensity = 0.0011 + this._density * 0.0016;
    scene.fog = new THREE.FogExp2(this._fogColor.getHex(), this._fogDensity);
    this._ownsFog = true;
  }

  /**
   * Advance the sky. sunElevation ∈ [-1,1] is the sine of the sun's elevation
   * angle (1 = zenith, 0 = horizon, negative = night). Recenters the dome and
   * the light rig on camPos.
   * @param {number} dt seconds
   * @param {number} sunElevation
   * @param {THREE.Vector3} camPos
   */
  update(dt, sunElevation, camPos) {
    const el = clamp(sunElevation, -1, 1);
    const cosE = Math.sqrt(Math.max(0, 1 - el * el));
    this.sunDir.set(Math.cos(this._azimuth) * cosE, el, Math.sin(this._azimuth) * cosE);

    const day = smooth01((el + 0.05) / 0.3);
    const night = 1 - smooth01((el + 0.18) / 0.26);
    const sunset = Math.exp(-((el - 0.02) * (el - 0.02)) / 0.028);
    const lowSun = Math.exp(-Math.max(el, 0) / 0.3);

    const u = this._uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uDay.value = day;
    u.uNight.value = night;
    u.uSunset.value = sunset;
    u.uSunCol.value.copy(this._sunColDay).lerp(this._sunColLow, clamp(lowSun * 0.85 + sunset * 0.4, 0, 1));
    if (camPos) this.dome.position.copy(camPos);

    // fog follows the horizon blend (warmed at sunset, darkened at night)
    this._fogColor.copy(this._horizonN).lerp(this._horizonDay, day);
    this._fogColor.lerp(this._sunsetCol, sunset * 0.3);
    u.uFog.value.copy(this._fogColor);
    if (this.scene.fog) {
      this.scene.fog.color.copy(this._fogColor);
      this.scene.fog.density = this._fogDensity;
    }

    // sun light follows elevation: warm when low, faint cool at night
    const warm = clamp(lowSun * 0.8 * day + sunset * 0.5, 0, 1);
    this.light.color.copy(this._sunColDay).lerp(this._sunColLow, warm);
    this.light.color.lerp(new THREE.Color(0.45, 0.55, 0.85), night);
    this.light.intensity = 0.18 + 4.2 * day * (1 - 0.3 * sunset);
    if (camPos) {
      this.light.position.copy(camPos).addScaledVector(this.sunDir, 430);
      this.light.target.position.copy(camPos);
    }

    this.ambient.intensity = 0.22 + 0.62 * day;
    this.ambient.color.copy(this._zenith).lerp(new THREE.Color(1, 1, 1), 0.2)
      .lerp(new THREE.Color(0.12, 0.16, 0.3), night);
  }

  /** Remove the dome and lights; clears the fog this dome installed. */
  dispose() {
    this.scene.remove(this.dome, this.light, this.light.target, this.ambient);
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this._starTex.dispose();
    this.light.dispose();
    this.ambient.dispose();
    if (this._ownsFog) this.scene.fog = null;
  }
}
