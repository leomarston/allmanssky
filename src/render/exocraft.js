// Exocraft — a summonable 4-wheel all-terrain rover for surface traversal.
// Procedural chunky hull with seed-tinted paint, a glass canopy, independent
// wheels, and HDR headlights. RoverController animates and drives it.
import * as THREE from 'three';
import { RNG, hashString } from '../core/rng.js';

function paintTexture(rng) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const hue = rng.range(0, 360);
  g.fillStyle = `hsl(${hue}, 34%, 42%)`;
  g.fillRect(0, 0, S, S);
  // panel lines + a hazard stripe
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    const y = (i / 6) * S + rng.range(-6, 6);
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
  }
  g.fillStyle = `hsl(${(hue + 40) % 360}, 60%, 55%)`;
  g.fillRect(0, S * 0.44, S, S * 0.08);
  // wear speckle
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let i = 0; i < 40; i++) g.fillRect(rng.range(0, S), rng.range(0, S), rng.range(1, 4), rng.range(1, 4));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param {number} seed
 * @returns {{ group: THREE.Group, wheels: {mesh: THREE.Object3D, radius: number}[],
 *   headlights: THREE.Mesh[], profile: { name: string }, dispose(): void }}
 */
export function buildRover(seed) {
  const rng = new RNG(((seed | 0) ^ 0x520f3) >>> 0);
  const g = new THREE.Group();
  const disposables = [];

  const tex = paintTexture(rng);
  disposables.push(tex);
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.7, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fd6e8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.42,
    emissive: 0x0a2028, emissiveIntensity: 0.5,
  });
  disposables.push(bodyMat, darkMat, glassMat);

  const box = (w, h, d, m, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    disposables.push(mesh.geometry);
    return mesh;
  };

  // chassis + upper hull
  box(2.0, 0.5, 3.0, bodyMat, 0, 0.85, 0);
  box(1.7, 0.55, 1.5, bodyMat, 0, 1.32, -0.2);
  // canopy bubble
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.72, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), glassMat);
  canopy.scale.set(1.0, 0.7, 1.1);
  canopy.position.set(0, 1.5, 0.25);
  canopy.castShadow = true;
  g.add(canopy);
  disposables.push(canopy.geometry);
  // rear cargo rack
  box(1.6, 0.14, 0.9, darkMat, 0, 1.18, 1.35);
  box(0.06, 0.32, 0.06, darkMat, -0.75, 1.32, 1.35);
  box(0.06, 0.32, 0.06, darkMat, 0.75, 1.32, 1.35);
  // roof light bar + antenna
  box(1.2, 0.1, 0.14, darkMat, 0, 1.72, -0.55);
  box(0.03, 0.7, 0.03, darkMat, 0.6, 2.0, -0.3);

  // headlights (HDR emissive discs); SpotLights added by the controller
  const headlights = [];
  const hlGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.08, 12);
  const hlMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 2.8, 2.2) });
  disposables.push(hlGeo, hlMat);
  for (const sx of [-0.6, 0.6]) {
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(sx, 0.9, -1.55);
    g.add(hl);
    headlights.push(hl);
  }

  // four independent wheels
  const wheels = [];
  const wR = 0.5;
  const wheelGeo = new THREE.CylinderGeometry(wR, wR, 0.36, 14);
  const treadGeo = new THREE.BoxGeometry(0.4, 0.12, 0.12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x181a1c, roughness: 0.9, metalness: 0.1 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x6a7076, roughness: 0.5, metalness: 0.7 });
  disposables.push(wheelGeo, treadGeo, wheelMat, hubMat);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, wheelMat);
      tire.rotation.z = Math.PI / 2;
      tire.castShadow = true;
      w.add(tire);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 8), hubMat);
      hub.rotation.z = Math.PI / 2;
      w.add(hub);
      disposables.push(hub.geometry);
      // tread bumps
      for (let i = 0; i < 6; i++) {
        const t = new THREE.Mesh(treadGeo, wheelMat);
        const a = (i / 6) * Math.PI * 2;
        t.position.set(0, Math.cos(a) * wR, Math.sin(a) * wR);
        t.rotation.x = a;
        w.add(t);
      }
      w.position.set(sx * 0.95, 0.5, sz * 1.05);
      g.add(w);
      wheels.push({ mesh: w, radius: wR, sx, sz });
    }
  }

  return {
    group: g,
    wheels,
    headlights,
    profile: { name: `Nomad-${(seed % 900 + 100)}` },
    dispose() { for (const d of disposables) d.dispose?.(); },
  };
}
