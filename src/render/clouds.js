// Cloud layer: transparent shell slightly above the planet surface with a
// seeded, seam-free procedural cloud texture (3D warped fbm sampled on the
// sphere, coverage-thresholded, soft alpha), independent slow rotation and
// sun-side shading with a warm terminator lining.
import * as THREE from 'three';
import { RNG } from '../core/rng.js';
import { SimplexNoise } from '../core/noise.js';

const CLOUD_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  vUv = uv;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const CLOUD_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vWorldPos;
void main() {
  #include <logdepthbuf_fragment>
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.01) discard;
  vec3 N = normalize(vNormalW);
  float ndl = dot(N, uSunDir);
  float day = clamp(ndl * 1.05 + 0.08, 0.0, 1.0);
  float shade = pow(day, 0.6);

  // Sun-lit white with self-shadowed undersides (tex.r carries density detail),
  // plus a warm silver lining band along the terminator.
  vec3 col = uColor * tex.r * (0.015 + 1.05 * shade);
  float term = 1.0 - smoothstep(0.0, 0.32, abs(ndl));
  col = mix(col, uColor * tex.r * vec3(1.05, 0.66, 0.44), term * 0.45);

  // Clouds thin out visually on the deep night side so the dark hemisphere
  // stays near-black instead of showing grey blobs.
  float alpha = tex.a * uOpacity * (0.35 + 0.65 * smoothstep(-0.35, 0.05, ndl));
  gl_FragColor = vec4(col, alpha);
}
`;

function smoothstepJS(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Bake a seam-free equirect cloud map by sampling warped 3D fbm along sphere
 * directions (no pole pinch, no wrap seam). Density detail in RGB, soft
 * coverage-thresholded alpha in A.
 */
function makeCloudTexture(seed, coverage, w = 768, h = 384) {
  const rng = new RNG(seed);
  const noise = new SimplexNoise(rng.int(0, 0x7fffffff));
  const ox = rng.range(-32, 32), oy = rng.range(-32, 32), oz = rng.range(-32, 32);
  const f = rng.range(2.0, 2.8);          // base cloud-mass frequency
  const warp = rng.range(0.8, 1.4);       // swirl amount
  const stretch = rng.range(1.25, 1.8);   // latitudinal stretch → banded flow
  // fbm values concentrate near 0; map coverage → threshold empirically.
  const th = 0.5 + (0.5 - coverage) * 0.30;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const data = img.data;

  for (let y = 0; y < h; y++) {
    const lat = ((y + 0.5) / h - 0.5) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const dx = cl * Math.cos(lon), dy = sl, dz = cl * Math.sin(lon);
      // domain warp for cyclonic swirl
      const wx = noise.fbm3(dx * f + ox + 13.1, dy * f + oy, dz * f + oz, 3);
      const wy = noise.fbm3(dx * f + ox, dy * f + oy - 7.7, dz * f + oz + 3.3, 3);
      const v = noise.fbm3(
        dx * f + wx * warp + ox,
        dy * f * stretch + wy * warp + oy,
        dz * f + (wx - wy) * warp * 0.6 + oz,
        5) * 0.5 + 0.5;
      let a = smoothstepJS(th, th + 0.17, v);
      // wispy interior density so cloud masses aren't flat white
      const d = noise.fbm3(dx * 7.5 + oz, dy * 7.5 + ox, dz * 7.5 + oy, 3) * 0.5 + 0.5;
      a *= 0.55 + 0.45 * d;
      const i = (y * w + x) * 4;
      const lum = Math.round(235 - 65 * (1 - d));
      data[i] = lum; data[i + 1] = lum; data[i + 2] = lum;
      data[i + 3] = Math.round(255 * Math.min(a, 1));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Create a slowly-drifting procedural cloud shell for a from-space planet.
 *
 * @param {number} radius planet radius in world units
 * @param {{coverage:number, colorHex:(string|number)}} cloudsDef `PlanetDef.clouds` shape
 * @param {number} seed deterministic world seed for this planet's clouds
 * @returns {{object3d: THREE.Mesh, update(dt:number, sunDir?:THREE.Vector3):void,
 *           dispose():void}} add `object3d` as a child of the planet group.
 */
export function createCloudLayer(radius, cloudsDef, seed) {
  const coverage = THREE.MathUtils.clamp(cloudsDef?.coverage ?? 0.5, 0, 1);
  const rng = new RNG((seed ?? 1) >>> 0);
  const tex = makeCloudTexture(rng.fork('cloudtex').seed, coverage);

  const mat = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    uniforms: {
      uMap: { value: tex },
      uColor: { value: new THREE.Color(cloudsDef?.colorHex ?? 0xffffff) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uOpacity: { value: 0.92 },
    },
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.018, 64, 48), mat);
  mesh.name = 'clouds';
  mesh.renderOrder = 2;
  mesh.rotation.y = rng.range(0, Math.PI * 2);
  const drift = rng.range(0.006, 0.014) * (rng.chance(0.5) ? 1 : -1);

  return {
    object3d: mesh,

    /**
     * @param {number} dt seconds — drives slow independent rotation
     * @param {THREE.Vector3} [sunDir] world-space unit vector toward the sun
     */
    update(dt, sunDir) {
      mesh.rotation.y += drift * dt;
      if (sunDir) mat.uniforms.uSunDir.value.copy(sunDir).normalize();
    },

    /** Release GPU resources and detach from the scene graph. */
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      tex.dispose();
      mat.dispose();
    },
  };
}
