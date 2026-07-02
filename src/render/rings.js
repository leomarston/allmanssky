// Planetary rings: annulus with a seeded procedural radial band texture
// (density striations, Cassini-style gaps, subtle hue drift), double-sided
// soft-alpha shading lit by the sun, including the planet's cast shadow
// sweeping across the ring plane.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

const RING_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vCenter;
varying vec3 vNormalW;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const RING_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uSunDir;
uniform float uPlanetR;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vWorldPos;
varying vec3 vCenter;
varying vec3 vNormalW;
void main() {
  #include <logdepthbuf_fragment>
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.004) discard;

  // Planet shadow: fragments inside the anti-sunward shadow cylinder go dark.
  vec3 rel = vWorldPos - vCenter;
  float along = dot(rel, -uSunDir);
  float lit = 1.0;
  if (along > 0.0) {
    float d = length(rel + uSunDir * along);
    lit = smoothstep(uPlanetR * 0.985, uPlanetR * 1.14, d);
  }

  // Thin particle disc: lambert on the plane normal + ambient backscatter,
  // with a touch of forward scattering when viewing toward the sun.
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndl = abs(dot(normalize(vNormalW), uSunDir));
  float fwd = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 4.0);
  float bright = 0.16 + 0.95 * ndl + 0.35 * fwd;

  vec3 col = tex.rgb * bright * mix(0.045, 1.0, lit);
  gl_FragColor = vec4(col, tex.a * uOpacity);
}
`;

function smoothstepJS(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Bake the radial band strip: u = (r - innerR) / (outerR - innerR). */
function ringTexture(ringsDef, seed) {
  const w = 1024, h = 4;
  const rng = new RNG((seed ?? 1) >>> 0);
  const noise = new SimplexNoise(rng.int(0, 0x7fffffff));
  const oy = rng.range(0, 64);
  const base = new THREE.Color(ringsDef?.colorHex ?? 0xcbb89a);

  // A few sharp gaps plus one broad division for that classic layered look.
  const gaps = [];
  const nGaps = rng.int(2, 4);
  for (let i = 0; i < nGaps; i++) {
    gaps.push({ pos: rng.range(0.12, 0.92), width: rng.range(0.012, 0.05), depth: rng.range(0.6, 0.98) });
  }
  gaps.push({ pos: rng.range(0.35, 0.72), width: rng.range(0.08, 0.14), depth: rng.range(0.8, 0.95) });

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const tint = new THREE.Color();

  for (let x = 0; x < w; x++) {
    const r = (x + 0.5) / w;
    // layered striations: broad density waves × fine ringlets
    let d = 0.55 + 0.45 * noise.fbm2(r * 13, oy, 4);
    d *= 0.66 + 0.34 * (noise.fbm2(r * 90, oy + 7.7, 3) * 0.5 + 0.5);
    d *= 0.84 + 0.16 * (noise.noise2D(r * 300, oy + 21.3) * 0.5 + 0.5);
    d = Math.pow(Math.min(Math.max(d, 0), 1), 1.35);
    for (const g of gaps) {
      const e = (r - g.pos) / g.width;
      d *= 1 - g.depth * Math.exp(-e * e);
    }
    // soft inner/outer edges
    d *= smoothstepJS(0, 0.05, r) * (1 - smoothstepJS(0.88, 1, r));

    // subtle color variation across the disc (icy ↔ dusty drift)
    tint.copy(base).offsetHSL(
      noise.fbm2(r * 3.3, oy + 31.1, 3) * 0.022,
      noise.fbm2(r * 5.1, oy + 13.7, 3) * 0.06,
      noise.fbm2(r * 8.7, oy + 43.9, 3) * 0.05
    );
    const lum = 0.72 + 0.28 * d;
    const R = Math.round(255 * Math.min(tint.r * lum, 1));
    const G = Math.round(255 * Math.min(tint.g * lum, 1));
    const B = Math.round(255 * Math.min(tint.b * lum, 1));
    const A = Math.round(255 * d);
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      data[i] = R; data[i + 1] = G; data[i + 2] = B; data[i + 3] = A;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Create a procedural ring disc for a from-space planet. The mesh lies in the
 * planet's equatorial (XZ) plane, centred on the planet group origin.
 *
 * @param {{innerR:number, outerR:number, colorHex:(string|number), opacity:number}} ringsDef
 *          `PlanetDef.rings` shape (radii in world units).
 * @param {number} seed deterministic world seed for this planet's rings
 * @param {number} [planetRadius] planet radius for the cast shadow
 *          (defaults to an estimate from `innerR`).
 * @returns {{object3d: THREE.Mesh, update(dt:number, sunDir?:THREE.Vector3):void,
 *           dispose():void}} add `object3d` as a child of the planet group.
 */
export function createRings(ringsDef, seed, planetRadius = (ringsDef?.innerR ?? 60) * 0.72) {
  const innerR = ringsDef?.innerR ?? 60;
  const outerR = Math.max(ringsDef?.outerR ?? innerR * 1.6, innerR + 1);
  const tex = ringTexture(ringsDef, seed);

  const geo = new THREE.RingGeometry(innerR, outerR, 256, 6);
  // remap UVs so u runs radially across the band strip
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - innerR) / (outerR - innerR), 0.5);
  }
  uv.needsUpdate = true;

  const mat = new THREE.ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: {
      uMap: { value: tex },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uPlanetR: { value: planetRadius },
      uOpacity: { value: THREE.MathUtils.clamp(ringsDef?.opacity ?? 0.85, 0, 1) },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'rings';
  mesh.rotation.x = -Math.PI / 2; // into the equatorial plane
  mesh.renderOrder = 3;

  return {
    object3d: mesh,

    /**
     * @param {number} dt seconds (rings are static; kept for contract symmetry)
     * @param {THREE.Vector3} [sunDir] world-space unit vector toward the sun
     */
    update(dt, sunDir) {
      if (sunDir) mat.uniforms.uSunDir.value.copy(sunDir).normalize();
    },

    /** Release GPU resources and detach from the scene graph. */
    dispose() {
      mesh.removeFromParent();
      geo.dispose();
      tex.dispose();
      mat.dispose();
    },
  };
}
