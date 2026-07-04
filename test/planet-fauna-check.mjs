// Fauna check for the seamless spherical planet (?state=planet).
// Boots the REAL app, teleports the player to a grassy, sun-lit, non-polar spot,
// disembarks, walks a few frames so creatures stream in, then asserts:
//   - zero page/console errors,
//   - fauna population > 0 near the surface,
//   - every active GROUND creature stays glued: |uniPos.len - (heightAt+offset)|
//     within a small tolerance (not sinking / flying off),
//   - creature.animate() ran without producing NaN in any beast's transform.
// Finally frames the on-foot camera at the nearest creature and screenshots
// test/screenshots/planet-fauna.png. Usage: node test/planet-fauna-check.mjs
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

// teleport to a grassy, sun-lit, non-polar direction so fauna is guaranteed.
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

// walk forward a couple of seconds so cells roll and creatures stream in.
await page.keyboard.down('w');
for (let i = 0; i < 30; i++) await page.waitForTimeout(50);
await page.keyboard.up('w');
await page.waitForTimeout(400);

// sample fauna state: count, glued invariant, NaN-free transforms.
const info = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const f = s.fauna;
  const planet = s.planet;
  const THREE = s.playerUniPos.constructor;
  const d = new THREE();
  let worstGlue = 0, anyNaN = false, walkers = 0;
  const types = {};
  for (const c of f.creatures) {
    types[c.profile.bodyType] = (types[c.profile.bodyType] || 0) + 1;
    d.copy(c.uniPos).normalize();
    const expect = planet.heightAt(d) + c.offset;
    const err = Math.abs(c.uniPos.length() - expect);
    if (c.profile.bodyType !== 'flyer' && c.profile.bodyType !== 'floater') {
      walkers++;
      if (err > worstGlue) worstGlue = err;
    }
    // NaN scan on the world matrix (position + orientation after animate)
    c.group.updateMatrixWorld(true);
    for (const e of c.group.matrixWorld.elements) if (!Number.isFinite(e)) anyNaN = true;
    if (!Number.isFinite(c.uniPos.x + c.uniPos.y + c.uniPos.z)) anyNaN = true;
    if (!Number.isFinite(c.heading.x + c.heading.y + c.heading.z)) anyNaN = true;
  }
  return {
    count: f.creatures.length, biome: f.biome, types,
    worstGlue, anyNaN, walkers,
    agl: s.agl, onGround: s.onGround, mode: s.mode,
  };
});

// frame the on-foot camera at the nearest ground creature for the screenshot.
const shot = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const f = s.fauna;
  const THREE = s.playerUniPos.constructor;
  // nearest walker (fall back to any) to the player.
  let best = null, bestD = 1e30;
  for (const c of f.creatures) {
    const d = c.uniPos.distanceToSquared(s.playerUniPos);
    const walker = c.profile.bodyType !== 'flyer' && c.profile.bodyType !== 'floater';
    const score = walker ? d : d + 1e6;
    if (score < bestD) { bestD = score; best = c; }
  }
  if (!best) return null;
  // stand the player ~8 m from the beast, along a tangent, at eye height.
  const dir = best.uniPos.clone().normalize();
  const t0 = new THREE(0, 1, 0);
  if (Math.abs(dir.y) > 0.9) t0.set(1, 0, 0);
  t0.addScaledVector(dir, -t0.dot(dir)).normalize();
  const standUni = best.uniPos.clone().addScaledVector(t0, 8);
  const sdir = standUni.clone().normalize();
  const gR = s.planet.heightAt(sdir);
  s.playerUniPos.copy(sdir).multiplyScalar(gR + 1.7);
  s.footVel.set(0, 0, 0);
  s.onGround = true;
  // look from the player toward the creature (world = uni - playerUni).
  const toC = best.uniPos.clone().sub(s.playerUniPos);
  const up = s.playerUniPos.clone().normalize();
  const fwdTan = toC.clone().addScaledVector(up, -toC.dot(up));
  if (fwdTan.lengthSq() > 1e-6) s.footFwd.copy(fwdTan).normalize();
  const horiz = fwdTan.length(), vert = toC.dot(up);
  s.pitch = Math.atan2(vert, horiz);
  return { name: best.profile.name, bodyType: best.profile.bodyType, size: best.profile.size };
});

await page.waitForTimeout(500);   // let a few frames orient the camera + settle
const buf = await page.screenshot({ path: 'test/screenshots/planet-fauna.png' });

await browser.close();
server.close();

const realErrors = errors.filter((e) => !/favicon/i.test(e));
const TOL = 0.6;                   // metres — glued tolerance for walkers
const gluedOk = info.walkers === 0 ? true : info.worstGlue < TOL;
const out = {
  target, errors: realErrors.slice(0, 12),
  mode: info.mode, onGround: info.onGround, agl: Number(info.agl?.toFixed?.(2) ?? info.agl),
  count: info.count, biome: info.biome, types: info.types,
  walkers: info.walkers, worstGlue: Number(info.worstGlue.toFixed(4)), gluedOk,
  anyNaN: info.anyNaN, shot, pngBytes: buf.length, lit: buf.length > 20000,
};
console.log(JSON.stringify(out, null, 2));
if (realErrors.length || info.count <= 0 || !gluedOk || info.anyNaN || !out.lit
  || info.mode !== 'foot') {
  console.error('PLANET-FAUNA CHECK FAILED');
  process.exit(1);
}
console.log('PLANET-FAUNA CHECK PASSED');
