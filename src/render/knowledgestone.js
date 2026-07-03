// Knowledge stone — a waist-high Luminel monolith that teaches one word when
// touched. Dark angular stone with a single glowing glyph face and a slow
// pulse; matches the ruin/beacon visual family (dark stone + cyan-white glow).
import * as THREE from 'three';

function glyphTexture(rng) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#05121a';
  g.fillRect(0, 0, S, S);
  // 2-4 strokes + a dot — a seeded rune
  g.strokeStyle = '#dff6ff';
  g.lineWidth = 6;
  g.lineCap = 'round';
  g.shadowColor = '#7de8ff';
  g.shadowBlur = 12;
  const cx = S / 2, cy = S / 2;
  const strokes = 2 + Math.floor(rng.next() * 3);
  for (let i = 0; i < strokes; i++) {
    const a0 = rng.range(0, Math.PI * 2);
    const a1 = a0 + rng.range(0.6, 2.4);
    const r0 = rng.range(12, 24), r1 = rng.range(28, 46);
    g.beginPath();
    g.moveTo(cx + Math.cos(a0) * r0, cy + Math.sin(a0) * r0);
    if (rng.chance(0.5)) {
      g.lineTo(cx + Math.cos(a1) * r1, cy + Math.sin(a1) * r1);
    } else {
      g.arc(cx, cy, r1, a0, a1);
    }
    g.stroke();
  }
  g.beginPath();
  g.arc(cx + rng.range(-14, 14), cy + rng.range(-14, 14), 5, 0, Math.PI * 2);
  g.fillStyle = '#dff6ff';
  g.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * @param {import('../core/rng.js').RNG} rng
 * @returns {{ object3d: THREE.Group, interactRadius: number, kind: 'stone', update(dt): void, dispose(): void }}
 */
export function createKnowledgeStone(rng) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x2b333b, roughness: 0.85, metalness: 0.15 });

  // tapered angular slab, slightly leaning
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 1.5, 5), stoneMat);
  body.position.y = 0.75;
  body.rotation.y = rng.range(0, Math.PI);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.25, 6), stoneMat);
  base.position.y = 0.12;
  base.castShadow = base.receiveShadow = true;
  g.add(base);

  // glowing glyph face
  const tex = glyphTexture(rng);
  const glyphMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true,
    color: new THREE.Color(1.4, 2.0, 2.4), // HDR → bloom
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), glyphMat);
  glyph.position.set(0, 0.92, 0.42);
  g.add(glyph);
  g.rotation.y = rng.range(0, Math.PI * 2);

  // floating dust mote sprite
  const dustCv = document.createElement('canvas');
  dustCv.width = dustCv.height = 32;
  const dg = dustCv.getContext('2d');
  const grad = dg.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(180,235,255,0.9)');
  grad.addColorStop(1, 'rgba(180,235,255,0)');
  dg.fillStyle = grad; dg.fillRect(0, 0, 32, 32);
  const dustTex = new THREE.CanvasTexture(dustCv);
  const dust = new THREE.Sprite(new THREE.SpriteMaterial({
    map: dustTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    color: new THREE.Color(1.2, 1.6, 2.0),
  }));
  dust.scale.setScalar(0.5);
  dust.position.set(0, 1.4, 0.42);
  g.add(dust);

  let t = rng.range(0, 10);
  return {
    object3d: g,
    interactRadius: 4,
    kind: 'stone',
    update(dt) {
      t += dt;
      const pulse = 0.7 + 0.3 * Math.sin(t * 1.8);
      glyphMat.color.setRGB(1.4 * pulse, 2.0 * pulse, 2.4 * pulse);
      dust.position.y = 1.4 + Math.sin(t * 0.9) * 0.12;
      dust.material.opacity = 0.5 + 0.4 * Math.sin(t * 1.3);
    },
    dispose() {
      body.geometry.dispose(); base.geometry.dispose(); glyph.geometry.dispose();
      stoneMat.dispose(); glyphMat.dispose(); tex.dispose();
      dust.material.dispose(); dustTex.dispose();
    },
  };
}
