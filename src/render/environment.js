// SkyEnvironment — image-based lighting (IBL) for the whole scene. The single
// biggest "flat three.js → real PBR engine" cue: without an environment map,
// MeshStandardMaterial surfaces get no specular reflection and only flat ambient,
// so metal/hull/glass read as dead paint. This builds a prefiltered radiance
// environment (PMREM) from a lightweight procedural sky — zenith→horizon gradient,
// a bright sun disc, and a ground bounce — and assigns it as `scene.environment`,
// so every standard material picks up real reflections + directional ambient.
// Renderer-agnostic: works on the WebGL2 pipeline today and ports unchanged to a
// WebGPU backend later. Regenerated only when the sun moves meaningfully.
import * as THREE from 'three';

const ENV_VERT = /* glsl */`
  varying vec3 vDir;
  void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// HDR-ish gradient with a soft horizon band and a ground hemisphere; the sun is a
// separate emissive mesh so PMREM captures a real bright highlight for reflections.
const ENV_FRAG = /* glsl */`
  uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunCol;
  uniform float uSunI, uHaze;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.45 + 0.35 * uHaze));
    sky = mix(sky, uGround, smoothstep(0.0, -0.35, y));          // ground bounce below horizon
    float c = max(dot(d, normalize(uSunDir)), 0.0);
    sky += uSunCol * (pow(c, 900.0) * uSunI * 6.0 + pow(c, 26.0) * 0.25 * uSunI); // disc + glow
    gl_FragColor = vec4(sky, 1.0);
  }`;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {object} [opts]
 * @returns {{ texture: THREE.Texture, update: (p:object)=>void, apply:(scene:THREE.Scene)=>void, dispose: ()=>void }}
 */
export function createSkyEnvironment(renderer, opts = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const uniforms = {
    uZenith: { value: new THREE.Color(opts.zenith ?? '#3a6ea5') },
    uHorizon: { value: new THREE.Color(opts.horizon ?? '#cdd9e4') },
    uGround: { value: new THREE.Color(opts.ground ?? '#3b3a30') },
    uSunDir: { value: (opts.sunDir ?? new THREE.Vector3(0.4, 0.7, 0.4)).clone().normalize() },
    uSunCol: { value: new THREE.Color(opts.sunColor ?? '#fff2d8') },
    uSunI: { value: opts.sunIntensity ?? 3.0 },
    uHaze: { value: opts.haze ?? 0.4 },
  };

  const envScene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 32, 16),
    new THREE.ShaderMaterial({ vertexShader: ENV_VERT, fragmentShader: ENV_FRAG, uniforms, side: THREE.BackSide, depthWrite: false }),
  );
  envScene.add(dome);

  let rt = null;
  const _lastSun = new THREE.Vector3();

  function regenerate() {
    if (rt) rt.dispose();
    rt = pmrem.fromScene(envScene, opts.sigma ?? 0.02);
    _lastSun.copy(uniforms.uSunDir.value);
    return rt.texture;
  }

  const api = {
    texture: null,
    /** Update sky/sun params; regenerates the PMREM only if the sun moved enough. */
    update(p = {}) {
      if (p.zenith) uniforms.uZenith.value.set(p.zenith);
      if (p.horizon) uniforms.uHorizon.value.set(p.horizon);
      if (p.ground) uniforms.uGround.value.set(p.ground);
      if (p.sunColor) uniforms.uSunCol.value.set(p.sunColor);
      if (p.sunIntensity != null) uniforms.uSunI.value = p.sunIntensity;
      if (p.haze != null) uniforms.uHaze.value = p.haze;
      let moved = false;
      if (p.sunDir) {
        uniforms.uSunDir.value.copy(p.sunDir).normalize();
        moved = uniforms.uSunDir.value.dot(_lastSun) < 0.985;   // ~10° of drift
      }
      if (moved || p.force) { api.texture = regenerate(); return true; }
      return false;
    },
    /** Assign this environment to a scene (IBL for every standard material). */
    apply(scene, intensity = 1.0) {
      scene.environment = api.texture;
      scene.environmentIntensity = intensity;
    },
    dispose() {
      rt?.dispose();
      dome.geometry.dispose();
      dome.material.dispose();
      pmrem.dispose();
    },
  };

  api.texture = regenerate();
  return api;
}
