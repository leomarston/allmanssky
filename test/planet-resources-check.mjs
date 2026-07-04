// Harvestable-resource check for the seamless spherical planet (?state=planet).
// Boots the REAL app, teleports the player to a grassy, sun-lit, non-polar spot,
// disembarks, walks a few frames so resource cells stream in, then asserts:
//   - zero page/console errors,
//   - resource node population > 0 near the surface,
//   - every node stays glued: |heightAt(node.dir) - node.r| within a small
//     tolerance, and no NaN in node.dir / node.r,
//   - the mining loop WORKS headlessly: aim at the nearest node, hold LMB for a
//     few 0.55s ticks, and either the inventory grows, a node depletes, or the
//     node count drops.
// Finally screenshots test/screenshots/planet-resources.png.
// Usage: node test/planet-resources-check.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm',
};

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(root, path === '/' ? '/index.html' : path);
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(`http://127.0.0.1:${port}/index.html?state=planet`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'planet', { timeout: 30000 });
await page.waitForTimeout(600);

// teleport to a grassy, sun-lit, non-polar direction so nodes are guaranteed.
const target = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const THREE = s.playerUniPos.constructor;
  const sun = new THREE(0.55, 0.42, 0.72).normalize();
  let best = null, bestScore = -1e9, st = 0x1234abcd >>> 0;
  const rnd = () => ((st = (Math.imul(st ^ (st >>> 15), 0x2c1b3c6d)) >>> 0) / 4294967296);
  const d = new THREE();
  for (let i = 0; i < 4000; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
    d.set(Math.cos(a) * sr, u, Math.sin(a) * sr);
    if (Math.abs(d.y) > 0.45) continue;
    if (d.dot(sun) < 0.35) continue;
    const alt = s.planet.heightAt(d) - s.planet.radius;
    if (alt < 14 || alt > 46) continue;
    const score = -Math.abs(alt - 28);
    if (score > bestScore) { bestScore = score; best = d.clone(); }
  }
  if (!best) return null;
  const groundR = s.planet.heightAt(best);
  s.playerUniPos.copy(best).multiplyScalar(groundR + 150);
  s.shipVel.set(0, 0, 0);
  return { dir: [best.x, best.y, best.z], alt: groundR - s.planet.radius };
});

await page.waitForTimeout(1500);   // let near-field chunks build at the new spot

await page.evaluate(() => window.__AMS__.game.state.disembark());
await page.waitForTimeout(400);

// walk forward ~1.5 s so cells roll and resource nodes stream in.
await page.keyboard.down('w');
for (let i = 0; i < 30; i++) await page.waitForTimeout(50);
await page.keyboard.up('w');
await page.waitForTimeout(400);

// sample resource state: count, glued invariant, NaN-free records.
const info = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const planet = s.planet;
  const nodes = s.resources.nodes;
  let worstGlue = 0, anyNaN = false;
  for (const n of nodes) {
    if (!Number.isFinite(n.dir.x + n.dir.y + n.dir.z + n.r)) anyNaN = true;
    const err = Math.abs(planet.heightAt(n.dir) - n.r);
    if (err > worstGlue) worstGlue = err;
  }
  return {
    count: nodes.length,
    worstGlue,
    anyNaN,
    counts: {
      spire: s.resources._spire.count,
      crystal: s.resources._crystal.count,
      pod: s.resources._pod.count,
    },
    agl: s.agl, mode: s.mode,
  };
});

// --- drive the mining loop headlessly ---------------------------------------
// stand the player ~5 m from the nearest node, along a tangent, at eye height.
const setup = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const THREE = s.playerUniPos.constructor;
  const nodes = s.resources.nodes;
  if (!nodes.length) return null;
  const base = new THREE();
  let best = null, bd = 1e30;
  for (const n of nodes) {
    base.copy(n.dir).multiplyScalar(n.r);
    const d = base.distanceToSquared(s.playerUniPos);
    if (d < bd) { bd = d; best = n; }
  }
  const nb = best.dir.clone().multiplyScalar(best.r);
  const dir = nb.clone().normalize();
  const t0 = new THREE(0, 1, 0);
  if (Math.abs(dir.y) > 0.9) t0.set(1, 0, 0);
  t0.addScaledVector(dir, -t0.dot(dir)).normalize();
  const standUni = nb.clone().addScaledVector(t0, 5);
  const sdir = standUni.clone().normalize();
  const gR = s.planet.heightAt(sdir);
  s.playerUniPos.copy(sdir).multiplyScalar(gR + 1.7);
  s.footVel.set(0, 0, 0);
  s.onGround = true;
  return { itemId: best.itemId, kind: best.kind };
});

// aim footFwd/pitch straight at the nearest node's base (= its pick reference).
async function aimAtNearest() {
  return page.evaluate(() => {
    const s = window.__AMS__.game.state;
    const THREE = s.playerUniPos.constructor;
    const nodes = s.resources.nodes;
    if (!nodes.length) return false;
    const base = new THREE();
    let best = null, bd = 1e30;
    for (const n of nodes) {
      base.copy(n.dir).multiplyScalar(n.r);
      const d = base.distanceToSquared(s.playerUniPos);
      if (d < bd) { bd = d; best = n; }
    }
    const nb = best.dir.clone().multiplyScalar(best.r);
    const toN = nb.clone().sub(s.playerUniPos);
    const up = s.playerUniPos.clone().normalize();
    const fwdTan = toN.clone().addScaledVector(up, -toN.dot(up));
    if (fwdTan.lengthSq() > 1e-6) s.footFwd.copy(fwdTan).normalize();
    const horiz = fwdTan.length(), vert = toN.dot(up);
    s.pitch = Math.atan2(vert, horiz);
    return true;
  });
}

await aimAtNearest();
await page.waitForTimeout(120);

// Hold the mine button for real: the mousedown lands on the canvas (setting
// input.mouseDown[0]) and the 1px move sets drag-look (so input.aiming is true).
await page.mouse.move(640, 360);
await page.mouse.down();
await page.mouse.move(641, 360);
await page.waitForTimeout(150);

// SwiftShader renders this HDR/bloom planet at well under 1 fps, and the engine
// clamps dt to 1/15 s, so a wall-clock hold can never accumulate the ~0.55 s
// mining ticks. Instead, with the mine button GENUINELY held (mouseDown[0] +
// aiming set by the real mouse events above), we pump the REAL state.update(dt)
// loop — this drives the true mining path (pickAlongAim → firing gate → tick →
// gs.addItem → resources.harvest) without waiting on the software renderer.
const mine = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const gs = window.__AMS__.game.gameState;
  const THREE = s.playerUniPos.constructor;
  const base = new THREE();
  const reaim = () => {
    const nodes = s.resources.nodes;
    if (!nodes.length) return false;
    let best = null, bd = 1e30;
    for (const n of nodes) {
      base.copy(n.dir).multiplyScalar(n.r);
      const d = base.distanceToSquared(s.playerUniPos);
      if (d < bd) { bd = d; best = n; }
    }
    const nb = best.dir.clone().multiplyScalar(best.r);
    const toN = nb.clone().sub(s.playerUniPos);
    const up = s.playerUniPos.clone().normalize();
    const fwd = toN.clone().addScaledVector(up, -toN.dot(up));
    if (fwd.lengthSq() > 1e-6) s.footFwd.copy(fwd).normalize();
    s.pitch = Math.atan2(toN.dot(up), fwd.length());
    return true;
  };
  const invBefore = gs.inventory.reduce((a, x) => a + x.qty, 0);
  const depBefore = s.resources._depleted.size;
  const nodesBefore = s.resources.nodes.length;
  const dt = 1 / 30;
  let iters = 0, beamSeen = false;
  for (let i = 0; i < 240; i++) {
    if (!reaim()) break;                 // keep the reticle on the nearest node
    s.update(dt);                        // real update: mining fires from held LMB
    iters++;
    if (s._mineBeam) beamSeen = true;
    const inv = gs.inventory.reduce((a, x) => a + x.qty, 0);
    if (inv - invBefore >= 8 && s.resources._depleted.size > depBefore) break;
  }
  return {
    iters, beamSeen,
    invBefore, invAfter: gs.inventory.reduce((a, x) => a + x.qty, 0),
    depBefore, depAfter: s.resources._depleted.size,
    nodesBefore, nodesAfter: s.resources.nodes.length,
    inventory: gs.inventory.map((x) => [x.id, x.qty]),
  };
});

await page.mouse.up();
await page.waitForTimeout(150);

const pre = { invQty: mine.invBefore, depleted: mine.depBefore, nodes: mine.nodesBefore };
const post = { invQty: mine.invAfter, depleted: mine.depAfter, nodes: mine.nodesAfter, inventory: mine.inventory };
const mined = post.invQty > pre.invQty || post.depleted > pre.depleted || post.nodes < pre.nodes;

const buf = await page.screenshot({ path: 'test/screenshots/planet-resources.png' });

await browser.close();
server.close();

const realErrors = errors.filter((e) => !/favicon/i.test(e));
const gluedOk = info.count === 0 ? false : info.worstGlue < 0.01;
const out = {
  target, errors: realErrors.slice(0, 12),
  mode: info.mode, agl: Number(info.agl?.toFixed?.(2) ?? info.agl),
  count: info.count, counts: info.counts,
  worstGlue: Number(info.worstGlue.toFixed(5)), gluedOk, anyNaN: info.anyNaN,
  setup, iters: mine.iters, beamSeen: mine.beamSeen, pre, post, mined,
  pngBytes: buf.length, lit: buf.length > 20000,
};
console.log(JSON.stringify(out, null, 2));
if (realErrors.length || info.count <= 0 || !gluedOk || info.anyNaN || !out.lit
  || info.mode !== 'foot' || !mined) {
  console.error('PLANET-RESOURCES CHECK FAILED');
  process.exit(1);
}
console.log('PLANET-RESOURCES CHECK PASSED');
