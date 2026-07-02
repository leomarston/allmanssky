// Rendering engine: WebGL2 renderer with HDR pipeline (ACES tonemapping),
// bloom composer, resize handling, and a fixed-timestep-friendly frame clock.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

    this.clock = new THREE.Clock();
    window.addEventListener('resize', () => this._onResize());
  }

  /** Point the pipeline at a scene+camera (rebuilds the composer). */
  setScene(scene, camera, { bloomStrength = 0.55, bloomRadius = 0.6, bloomThreshold = 0.85 } = {}) {
    this._scene = scene;
    this._camera = camera;
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(size, bloomStrength, bloomRadius, bloomThreshold);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
  }

  setExposure(v) { this.renderer.toneMappingExposure = v; }

  get camera() { return this._camera; }
  get scene() { return this._scene; }

  render() {
    if (this.composer) this.composer.render();
    else if (this._scene && this._camera) this.renderer.render(this._scene, this._camera);
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
    return Math.min(this.clock.getDelta(), 1 / 15);
  }
}
