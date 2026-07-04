// Ground-cover check for the seamless spherical planet (?state=planet).
// Boots the REAL app, teleports the player to a grassy, sun-lit, non-polar spot,
// disembarks, walks a few frames, and asserts: zero page/console errors, the
// on-foot player stays glued (AGL ~ eye height, no fall-through), and scatter
// instance count > 0 near the surface. Screenshots planet-scatter-foot.png.
// Usage: node test/planet-scatter-check.mjs
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

// teleport to a grassy, sun-lit, non-polar direction so cover is guaranteed
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
await page.waitForTimeout(600);

// walk forward and sample AGL
await page.keyboard.down('w');
const agl = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(50);
  agl.push(await page.evaluate(() => window.__AMS__.game.state.agl));
}
await page.keyboard.up('w');
await page.waitForTimeout(200);

const info = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const sc = s.scatter;
  return {
    mode: s.mode, agl: s.agl, onGround: s.onGround,
    counts: { grass: sc._grass.count, plant: sc._plant.count, rock: sc._rock.count },
    stats: s.planet.getStats(),
  };
});
const buf = await page.screenshot({ path: 'test/screenshots/planet-scatter-foot.png' });

await browser.close();
server.close();

const EYE = 1.7;
const gluedOk = agl.every((a) => a > EYE - 0.8 && a < EYE + 1.6);
const total = info.counts.grass + info.counts.plant + info.counts.rock;
const realErrors = errors.filter((e) => !/favicon/i.test(e));
const out = {
  target, errors: realErrors.slice(0, 12),
  mode: info.mode, onGround: info.onGround,
  aglRange: `${Math.min(...agl).toFixed(3)}..${Math.max(...agl).toFixed(3)}`,
  gluedOk, counts: info.counts, total, stats: info.stats,
  pngBytes: buf.length, lit: buf.length > 20000,
};
console.log(JSON.stringify(out, null, 2));
if (realErrors.length || info.mode !== 'foot' || !info.onGround || !gluedOk || total <= 0 || !out.lit) {
  console.error('PLANET-SCATTER CHECK FAILED');
  process.exit(1);
}
console.log('PLANET-SCATTER CHECK PASSED');
