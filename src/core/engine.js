// Rendering engine: WebGL2 renderer with an HDR pipeline (ACES tonemapping),
// a multisampled (MSAA) HDR composer, bloom, and a final cinematic color-grade
// pass (filmic contrast, saturation, vignette, subtle animated grain). Also
// owns resize handling and a fixed-timestep-friendly frame clock.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createAOPass, disposeAOPass } from '../render/postao.js';
import { createGodrayPass, disposeGodrayPass } from '../render/godrays.js';

// Final-image grade: operates on the tone-mapped, sRGB LDR frame (after
// OutputPass), so contrast/saturation/vignette are all display-safe. Grain is
// hash noise animated by uTime; kept subtle to read as film, not dither.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uSaturation: { value: 1.10 },
    uContrast: { value: 1.045 },
    uLift: { value: new THREE.Color(0.010, 0.014, 0.024) }, // cool shadow tint
    uVignette: { value: 0.34 },  // 0 = none, ~0.5 = strong
    uGrain: { value: 0.028 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uSaturation, uContrast, uVignette, uGrain;
    uniform vec3 uLift;
    varying vec2 vUv;
    float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // saturation around Rec.709 luma
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      // gentle S-curve contrast around mid-grey
      c = (c - 0.5) * uContrast + 0.5;
      // lifted, cool shadows (filmic toe)
      c += uLift * (1.0 - smoothstep(0.0, 0.5, l));
      // vignette
      vec2 d = vUv - 0.5;
      float vig = 1.0 - dot(d, d) * uVignette * 2.4;
      c *= clamp(vig, 0.0, 1.0);
      // subtle animated film grain, stronger in shadows
      float g = hash(vUv * 1024.0 + fract(uTime) * 97.0) - 0.5;
      c += g * uGrain * (0.6 + 0.8 * (1.0 - l));
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true, // space scenes span metres to megametres
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this._scene = null;
    this._camera = null;
    this.composer = null;
    this.bloomPass = null;
    this.gradePass = null;
    this.aoPass = null;
    this.godrayPass = null;
    this._time = 0;

    this.clock = new THREE.Clock();
    window.addEventListener('resize', () => this._onResize());
  }

  /** Point the pipeline at a scene+camera (rebuilds the composer). */
  setScene(scene, camera, {
    bloomStrength = 0.55, bloomRadius = 0.6, bloomThreshold = 0.85,
    grade = {}, aoScene = 'surface', aoEnabled = true, godrayEnabled = false,
  } = {}) {
    disposeAOPass(this.aoPass); this.aoPass = null;
    disposeGodrayPass(this.godrayPass); this.godrayPass = null;
    this._scene = scene;
    this._camera = camera;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);

    // HDR, multisampled intermediate target — restores the anti-aliasing that a
    // plain EffectComposer otherwise throws away, and gives bloom real headroom.
    const rt = new THREE.WebGLRenderTarget(
      Math.max(1, size.x * this.renderer.getPixelRatio()),
      Math.max(1, size.y * this.renderer.getPixelRatio()),
      { type: THREE.HalfFloatType, samples: 4 },
    );
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(size.x, size.y);
    this.composer.addPass(new RenderPass(scene, camera));
    // ambient occlusion / contact shadows — grounds geometry before it can bloom
    this.aoPass = createAOPass(scene, camera, size, { scene: aoScene, enabled: aoEnabled, renderer: this.renderer });
    if (this.aoPass) this.composer.addPass(this.aoPass);
    this.bloomPass = new UnrealBloomPass(size, bloomStrength, bloomRadius, bloomThreshold);
    this.composer.addPass(this.bloomPass);
    // crepuscular rays — after bloom (feeds off the HDR sun+halo), before Output
    // so shafts are ACES-tonemapped with the frame. Fed a sun only on the surface.
    this.godrayPass = createGodrayPass(scene, camera, size, { enabled: godrayEnabled, renderer: this.renderer });
    if (this.godrayPass) this.composer.addPass(this.godrayPass);
    this.composer.addPass(new OutputPass());

    // final cinematic grade (last pass → renders to screen)
    this.gradePass = new ShaderPass(GradeShader);
    for (const [k, v] of Object.entries(grade)) {
      if (this.gradePass.uniforms[k]) this.gradePass.uniforms[k].value = v;
    }
    this.composer.addPass(this.gradePass);
  }

  setExposure(v) { this.renderer.toneMappingExposure = v; }

  get camera() { return this._camera; }
  get scene() { return this._scene; }

  render() {
    if (this.composer) {
      if (this.gradePass) this.gradePass.uniforms.uTime.value = this._time;
      this.composer.render();
    } else if (this._scene && this._camera) {
      this.renderer.render(this._scene, this._camera);
    }
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    if (this._camera) {
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    }
  }

  /** clamped frame delta in seconds (avoids physics explosions on tab-switch) */
  tick() {
    const dt = Math.min(this.clock.getDelta(), 1 / 15);
    this._time += dt;
    return dt;
  }
}
