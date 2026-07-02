// AllMansSky entry point.
// SCAFFOLD BUILD: renders an engine validation scene (star + planet + bloom).
// Replaced by the full state machine (menu / space / surface) at integration.
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { input } from './core/input.js';
import { RNG } from './core/rng.js';
import { SimplexNoise } from './core/noise.js';

const canvas = document.getElementById('game-canvas');
const engine = new Engine(canvas);
input.attach(canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1e8);
camera.position.set(0, 6, 26);
camera.lookAt(0, 0, 0);

// --- validation content: hot star, shaded planet, particle starfield ---
const rng = new RNG(42);
const noise = new SimplexNoise(42);

const star = new THREE.Mesh(
  new THREE.SphereGeometry(4, 48, 48),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(4.0, 2.6, 1.2) }) // HDR emissive → bloom
);
star.position.set(-14, 2, -10);
scene.add(star);

const planetGeo = new THREE.SphereGeometry(5, 96, 96);
const pos = planetGeo.attributes.position;
const colors = new Float32Array(pos.count * 3);
const cA = new THREE.Color('#1c5d43'), cB = new THREE.Color('#c8b271'), cC = new THREE.Color('#274b8f');
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
  const n = noise.fbm3(x * 0.25, y * 0.25, z * 0.25, 5);
  const c = n < -0.08 ? cC : n < 0.22 ? cA : cB;
  colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
}
planetGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
const planet = new THREE.Mesh(planetGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
planet.position.set(6, 0, 0);
scene.add(planet);

const starCount = 4000;
const starPos = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const v = new THREE.Vector3(rng.gaussian(), rng.gaussian(), rng.gaussian()).normalize().multiplyScalar(900);
  starPos.set([v.x, v.y, v.z], i * 3);
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false })));

scene.add(new THREE.AmbientLight(0x334455, 0.4));
const sun = new THREE.PointLight(0xfff2dd, 3000);
sun.position.copy(star.position);
scene.add(sun);

engine.setScene(scene, camera);

let elapsed = 0;
function frame() {
  const dt = engine.tick();
  elapsed += dt;
  planet.rotation.y += dt * 0.15;
  camera.position.x = Math.sin(elapsed * 0.05) * 2;
  engine.render();
  input.endFrame();
  requestAnimationFrame(frame);
}
frame();

// smoke-test hook: lets headless tests confirm the engine came up
window.__AMS__ = { ready: true, engine };
