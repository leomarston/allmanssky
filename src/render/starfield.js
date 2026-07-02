// Deep-space backdrop for the space scene: a huge inward-facing skysphere with
// a procedurally painted galactic band (warm dust, dark lanes, distant-galaxy
// smudges, thousands of baked micro-stars) plus ~6000 shader-driven point
// stars with per-star color temperature and twinkle. Fully deterministic from
// the seed; zero external assets.
import * as THREE from 'three';
import { RNG, hash32, hashString } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

const SKY_RADIUS = 8.0e5;          // km-ish units; well inside the 1e8 far plane
const STAR_SHELL_RADIUS = 7.4e5;   // point stars sit just inside the skysphere
const STAR_COUNT = 6000;

/* ------------------------------------------------------------------ utils */

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smooth01(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

/** Uniform random direction on the unit sphere (deterministic via rng). */
function randomDir(rng, out) {
  out.set(rng.gaussian(), rng.gaussian(), rng.gaussian());
  if (out.lengthSq() < 1e-12) out.set(0, 1, 0);
  return out.normalize();
}

/**
 * World direction for an equirect texel matching THREE.SphereGeometry's UV
 * layout, so band math in the texture lines up with world-space star math.
 */
function dirFromUV(u, v, out) {
  const phi = u * Math.PI * 2;
  const theta = v * Math.PI;
  const st = Math.sin(theta);
  return out.set(-st * Math.cos(phi), Math.cos(theta), st * Math.sin(phi));
}

/** Tiny soft-dot sprite canvas used to stamp baked stars quickly. */
function makeDotSprite(size, r, g, b) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0.0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.25, `rgba(${r},${g},${b},0.75)`);
  grad.addColorStop(0.6, `rgba(${r},${g},${b},0.2)`);
  grad.addColorStop(1.0, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return c;
}

/* ------------------------------------------------- skysphere band texture */

/**
 * Paint the galactic backdrop: tilted milky-way band with warm dust color,
 * dark lanes, a bright galactic-core hotspot, distant galaxy smudges and
 * ~5000 baked micro-stars concentrated toward the band.
 * @returns {{ texture: THREE.CanvasTexture, bandNormal: THREE.Vector3 }}
 */
function makeSkyTexture(seed) {
  const rng = new RNG(hash32(seed, hashString('sky')));
  const noise = new SimplexNoise(hash32(seed, hashString('skynoise')));

  const W = 2048, H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // deep space base — near-black with the faintest blue lift
  ctx.fillStyle = '#020309';
  ctx.fillRect(0, 0, W, H);

  // band plane normal, tilted so the milky way crosses the sky diagonally
  const tilt = rng.range(0.6, 1.1);
  const az = rng.range(0, Math.PI * 2);
  const n = new THREE.Vector3(
    Math.sin(tilt) * Math.cos(az),
    Math.cos(tilt),
    Math.sin(tilt) * Math.sin(az)
  );

  // basis inside the band plane → galactic-core direction
  const ref = Math.abs(n.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u1 = new THREE.Vector3().crossVectors(n, ref).normalize();
  const u2 = new THREE.Vector3().crossVectors(n, u1).normalize();
  const gcA = rng.range(0, Math.PI * 2);
  const gc = u1.clone().multiplyScalar(Math.cos(gcA)).addScaledVector(u2, Math.sin(gcA));

  // --- diffuse band glow, computed low-res then upscaled (soft by design) ---
  const BW = 768, BH = 384;
  const bandCanvas = document.createElement('canvas');
  bandCanvas.width = BW; bandCanvas.height = BH;
  const bctx = bandCanvas.getContext('2d');
  const img = bctx.createImageData(BW, BH);
  const px = img.data;

  const o1 = rng.range(-60, 60), o2 = rng.range(-60, 60), o3 = rng.range(-60, 60);
  const sigma = rng.range(0.10, 0.135);
  const twoSig2 = 2 * sigma * sigma;
  const wide2 = 2 * (sigma * 3.2) * (sigma * 3.2);

  const warm = [1.0, 0.88, 0.68];   // creamy core
  const cool = [0.55, 0.66, 0.92];  // blue fringes
  const dustC = [0.85, 0.60, 0.42]; // warm dust tint

  const dir = new THREE.Vector3();
  for (let y = 0; y < BH; y++) {
    const v = (y + 0.5) / BH;
    for (let x = 0; x < BW; x++) {
      const u = (x + 0.5) / BW;
      dirFromUV(u, v, dir);
      const d = dir.dot(n);
      const core = Math.exp(-(d * d) / twoSig2);
      const wide = Math.exp(-(d * d) / wide2);

      // seamless (3D, on-sphere) noise fields
      const f1 = noise.fbm3(dir.x * 2.4 + o1, dir.y * 2.4 + o1, dir.z * 2.4 - o1, 4);
      const f2 = noise.fbm3(dir.x * 5.1 + o2, dir.y * 5.1 - o2, dir.z * 5.1 + o2, 4);
      const dens = 0.4 + 0.6 * Math.pow(0.5 + 0.5 * f1, 1.4);

      // dark dust lanes carving the bright core
      const laneN = 0.5 + 0.5 * noise.fbm3(dir.x * 3.4 - o3, dir.y * 3.4 + o3, dir.z * 3.4 + o3, 4);
      const lane = smooth01((laneN - 0.52) / 0.16) * Math.min(1, core * 1.6);

      // galactic-centre hotspot along the band
      const hs = Math.exp((dir.dot(gc) - 1) * 5.0);

      let glow =
        core * dens * (1 - 0.82 * lane) * (0.7 + 1.1 * hs) +
        wide * 0.10 * (0.5 + 0.5 * f2);
      glow = glow / (1 + glow * 0.55); // soft rolloff — keep hotspot structured

      // faint ambient nebulosity so empty sky isn't dead black
      const amb = Math.max(0, f2) * 0.035 + 0.01;

      const mixK = Math.min(1, core * (0.75 + 0.9 * hs));
      let r = lerp(cool[0], warm[0], mixK);
      let g = lerp(cool[1], warm[1], mixK);
      let b = lerp(cool[2], warm[2], mixK);
      const dustK = Math.max(0, f2) * 0.55 * Math.min(1, core * 1.2);
      r = lerp(r, dustC[0], dustK);
      g = lerp(g, dustC[1], dustK);
      b = lerp(b, dustC[2], dustK);

      const i = (y * BW + x) * 4;
      px[i] = Math.min(255, (glow * r + amb * 0.45) * 255);
      px[i + 1] = Math.min(255, (glow * g + amb * 0.55) * 255);
      px[i + 2] = Math.min(255, (glow * b + amb * 1.0) * 255);
      px[i + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bandCanvas, 0, 0, W, H);

  // --- distant galaxy smudges: faint rotated elliptical glows ---
  const galaxyCount = rng.int(22, 32);
  for (let iG = 0; iG < galaxyCount; iG++) {
    const gx = rng.range(0, W), gy = rng.range(H * 0.08, H * 0.92);
    const rad = rng.range(4, 15);
    ctx.save();
    ctx.translate(gx, gy);
    ctx.rotate(rng.range(0, Math.PI));
    ctx.scale(1, rng.range(0.22, 0.6));
    const warmG = rng.chance(0.4);
    const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    gg.addColorStop(0, warmG ? 'rgba(255,236,212,0.55)' : 'rgba(206,220,255,0.5)');
    gg.addColorStop(0.45, warmG ? 'rgba(224,192,160,0.16)' : 'rgba(162,182,236,0.15)');
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // --- baked micro-stars, density concentrated toward the band ---
  const sprites = [
    makeDotSprite(24, 255, 244, 228), // warm white
    makeDotSprite(24, 255, 255, 255), // white
    makeDotSprite(24, 198, 214, 255), // blue-white
    makeDotSprite(24, 255, 210, 158), // amber
    makeDotSprite(24, 255, 168, 128), // red-orange
  ];
  const sDir = new THREE.Vector3();
  const bandSig2 = 2 * 0.17 * 0.17;
  let placed = 0, guard = 0;
  while (placed < 5200 && guard++ < 80000) {
    randomDir(rng, sDir);
    const d = sDir.dot(n);
    const p = 0.15 + 0.85 * Math.exp(-(d * d) / bandSig2);
    if (!rng.chance(p)) continue;
    placed++;
    const v = Math.acos(clamp01((sDir.y + 1) / 2) * 2 - 1) / Math.PI;
    let u = Math.atan2(sDir.z, -sDir.x) / (Math.PI * 2);
    u = (u + 1) % 1;
    const bright = rng.chance(0.055);
    const s = bright ? rng.range(3.6, 6.8) : rng.range(1.0, 2.9);
    ctx.globalAlpha = bright ? rng.range(0.75, 1.0) : rng.range(0.28, 0.9);
    const w = rng.next();
    const spr = sprites[w < 0.3 ? 0 : w < 0.62 ? 1 : w < 0.82 ? 2 : w < 0.94 ? 3 : 4];
    ctx.drawImage(spr, u * W - s / 2, v * H - s / 2, s, s);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, bandNormal: n };
}

/* ------------------------------------------------------- point star shell */

// color temperature classes: [weight, linear-ish rgb]
const STAR_CLASSES = [
  { w: 0.07, c: [0.55, 0.68, 1.0] },  // hot blue
  { w: 0.17, c: [0.82, 0.88, 1.0] },  // blue-white
  { w: 0.24, c: [1.0, 1.0, 1.0] },    // white
  { w: 0.23, c: [1.0, 0.93, 0.78] },  // warm white
  { w: 0.15, c: [1.0, 0.80, 0.52] },  // yellow-orange
  { w: 0.09, c: [1.0, 0.60, 0.34] },  // orange
  { w: 0.05, c: [1.0, 0.44, 0.28] },  // red
];

function pickStarClass(rng) {
  let r = rng.next();
  for (const sc of STAR_CLASSES) {
    if ((r -= sc.w) <= 0) return sc.c;
  }
  return STAR_CLASSES[2].c;
}

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aBright;
attribute vec3 aColor;
attribute vec3 aTw; // phase, speed, amplitude
uniform float uTime;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vTw;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  float tw = 1.0 + aTw.z * sin(uTime * aTw.y + aTw.x);
  vTw = tw;
  vColor = aColor * aBright;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = aSize * uPixelRatio * (0.88 + 0.12 * tw);
  #include <logdepthbuf_vertex>
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vTw;
#include <common>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec2 p = gl_PointCoord - vec2(0.5);
  float d = length(p) * 2.0;
  if (d > 1.0) discard;
  float fall = 1.0 - d;
  float a = fall * fall * (0.3 + 0.7 * smoothstep(0.6, 0.0, d));
  gl_FragColor = vec4(vColor * vTw, a);
}
`;

/* ---------------------------------------------------------------- exports */

/**
 * Far-shell galaxy backdrop: procedural milky-way skysphere plus ~6000
 * twinkling color-temperature point stars. Deterministic from `seed`.
 * Add `object3d` to the space scene (keep it centered on/near the camera).
 * @param {number} seed integer world seed
 * @returns {{ object3d: THREE.Group, update: (dt: number, camQuat?: THREE.Quaternion) => void, dispose: () => void }}
 */
export function createStarfield(seed) {
  const group = new THREE.Group();
  group.name = 'starfield';

  // --- skysphere ---
  const { texture, bandNormal } = makeSkyTexture(seed);
  const skyGeo = new THREE.SphereGeometry(SKY_RADIUS, 64, 32);
  const skyMat = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  group.add(sky);

  // --- point stars on a shell just inside the sphere ---
  const rng = new RNG(hash32(seed, hashString('points')));
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const brights = new Float32Array(STAR_COUNT);
  const tw = new Float32Array(STAR_COUNT * 3);

  const v = new THREE.Vector3();
  const ptSig2 = 2 * 0.3 * 0.3;
  let i = 0, guard = 0;
  while (i < STAR_COUNT && guard++ < STAR_COUNT * 40) {
    randomDir(rng, v);
    const d = v.dot(bandNormal);
    // gentle band concentration (weaker than the baked layer)
    if (!rng.chance(0.35 + 0.65 * Math.exp(-(d * d) / ptSig2))) continue;
    positions[i * 3] = v.x * STAR_SHELL_RADIUS;
    positions[i * 3 + 1] = v.y * STAR_SHELL_RADIUS;
    positions[i * 3 + 2] = v.z * STAR_SHELL_RADIUS;

    const c = pickStarClass(rng);
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];

    const bright = rng.chance(0.07);
    const base = 0.3 + 0.7 * rng.next() * rng.next();
    brights[i] = bright ? rng.range(1.3, 2.4) : base;
    sizes[i] = (bright ? rng.range(2.6, 4.2) : rng.range(1.1, 2.6));

    tw[i * 3] = rng.range(0, Math.PI * 2);        // phase
    tw[i * 3 + 1] = rng.range(0.5, 3.2);          // speed
    tw[i * 3 + 2] = rng.range(0.06, bright ? 0.3 : 0.45); // amplitude
    i++;
  }

  const geo = new THREE.BufferGeometry();
  geo.setDrawRange(0, i); // guard: never draw unfilled slots
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(brights, 1));
  geo.setAttribute('aTw', new THREE.BufferAttribute(tw, 3));

  const starMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: {
        value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1,
      },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, starMat);
  points.renderOrder = -998;
  points.frustumCulled = false;
  group.add(points);

  /**
   * Advance twinkle + an almost imperceptible galactic drift.
   * @param {number} dt seconds
   * @param {THREE.Quaternion} [camQuat] reserved (backdrop is orientation-fixed)
   */
  function update(dt, camQuat) { // eslint-disable-line no-unused-vars
    starMat.uniforms.uTime.value += dt;
    group.rotation.y += dt * 0.00035;
  }

  /** Free GPU resources owned by the starfield. */
  function dispose() {
    skyGeo.dispose();
    skyMat.dispose();
    texture.dispose();
    geo.dispose();
    starMat.dispose();
  }

  return { object3d: group, update, dispose };
}
