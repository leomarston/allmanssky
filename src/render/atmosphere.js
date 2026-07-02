// Atmosphere shell: additive back-side fresnel rim that reads as scattered
// light hugging the planet limb — bright on the sun side, warm and thin at the
// terminator, near-dark on the night arc, with a soft forward-scatter halo
// when the planet is backlit. Pure shader, no textures.
import * as THREE from 'three';

const ATMO_VERT = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vCenter;
void main() {
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  #include <logdepthbuf_vertex>
}
`;

const ATMO_FRAG = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform float uDensity;
uniform float uMuMax;
varying vec3 vNormalW;
varying vec3 vWorldPos;
varying vec3 vCenter;
void main() {
  #include <logdepthbuf_fragment>
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 N = normalize(vNormalW);

  // Back faces: -dot(V,N) runs 0 at the outer silhouette of the shell up to
  // uMuMax at the planet limb. Normalizing gives a stable 0..1 "depth into
  // the atmosphere" coordinate regardless of shell thickness.
  float mu = clamp(-dot(V, N) / uMuMax, 0.0, 1.0);
  // Exponential-ish scattering falloff: dense at the limb, feathering out.
  float glow = pow(mu, 1.8) * 0.75 + pow(mu, 7.0) * 0.55 + mu * 0.07;

  // Screen-space rim direction (component of N perpendicular to the view)
  // tells us where this rim pixel sits relative to the sun for the day arc.
  vec3 rim = N - V * dot(N, V);
  float rimLen = max(length(rim), 1e-4);
  float sunSide = dot(rim / rimLen, uSunDir);
  float day = pow(clamp(sunSide * 0.62 + 0.45, 0.0, 1.0), 1.6);
  day = max(day, 0.02); // faint airglow survives on the night arc

  // Forward scattering: soft halo bloom when looking through the atmosphere
  // toward the sun (backlit crescent shots).
  float glare = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 6.0) * 0.6 * mu;

  float strength = 0.5 + 1.15 * uDensity;
  vec3 col = uColor * (glow * day * strength) + uColor * glare * uDensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Create an additive rim-scattering atmosphere shell for a from-space planet.
 *
 * @param {number} radius planet radius in world units
 * @param {{density:number, colorHex:(string|number), skyColorHex?:(string|number),
 *          fogColorHex?:(string|number)}} atmoDef `PlanetDef.atmosphere` shape;
 *          `density` (0..1) scales both shell thickness and glow intensity.
 * @returns {{object3d: THREE.Mesh, update(dt:number, sunDir?:THREE.Vector3):void,
 *           dispose():void}} add `object3d` as a child of the planet group;
 *           `sunDir` is a world-space unit vector pointing at the sun.
 */
export function createAtmosphere(radius, atmoDef) {
  const density = THREE.MathUtils.clamp(atmoDef?.density ?? 0.5, 0, 1);
  const shellR = radius * (1.035 + 0.045 * density);
  const ratio = radius / shellR;
  const muMax = Math.sqrt(Math.max(1 - ratio * ratio, 1e-4));

  const mat = new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(atmoDef?.colorHex ?? 0x88bbff) },
      uSunDir: { value: new THREE.Vector3(1, 0, 0) },
      uDensity: { value: density },
      uMuMax: { value: muMax },
    },
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(shellR, 64, 48), mat);
  mesh.name = 'atmosphere';
  mesh.renderOrder = 4;

  return {
    object3d: mesh,

    /**
     * @param {number} dt seconds (unused; kept for contract symmetry)
     * @param {THREE.Vector3} [sunDir] world-space unit vector toward the sun
     */
    update(dt, sunDir) {
      if (sunDir) mat.uniforms.uSunDir.value.copy(sunDir).normalize();
    },

    /** Release GPU resources and detach from the scene graph. */
    dispose() {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}
