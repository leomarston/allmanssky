// Proof shot of the REAL landing: boot space, fly-to-land on a living planet
// via the actual _land path, disembark, walk, screenshot. -> real-landing.png
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try { const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const data = await readFile(join(root, path === '/' ? '/index.html' : path));
    res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('x'); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`http://127.0.0.1:${port}/index.html?state=space`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'space', { timeout: 30000 });
await page.waitForTimeout(400);
const info = await page.evaluate(async () => {
  const g = window.__AMS__.game, space = g.state;
  const LIVING = ['lush', 'ocean', 'toxic', 'exotic', 'frozen', 'desert'];
  const p = space.planets.find((pl) => LIVING.includes(pl.def?.biome)) ?? space.planets[0];
  await space._land(p);
  return { biome: p.def?.biome };
});
await page.waitForFunction(() => window.__AMS__.game.state?.name === 'planet', { timeout: 30000 });
await page.evaluate(() => {
  const s = window.__AMS__.game.state, THREE = s.playerUniPos.constructor;
  const sun = new THREE(0.55, 0.42, 0.72).normalize();
  let best = null, bs = -1e9, st = 0x9ac1 >>> 0;
  const rnd = () => ((st = (Math.imul(st ^ (st >>> 15), 0x2c1b3c6d)) >>> 0) / 4294967296);
  const d = new THREE();
  for (let i = 0; i < 4000; i++) { const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
    d.set(Math.cos(a) * sr, u, Math.sin(a) * sr); if (Math.abs(d.y) > 0.45 || d.dot(sun) < 0.4) continue;
    const alt = s.planet.heightAt(d) - s.planet.radius; const sc = -Math.abs(alt - 30);
    if (sc > bs) { bs = sc; best = d.clone(); } }
  s.playerUniPos.copy(best).multiplyScalar(s.planet.heightAt(best) + 120); s.shipVel.set(0, 0, 0);
});
await page.waitForTimeout(1300);
await page.evaluate(() => window.__AMS__.game.state.disembark());
await page.keyboard.down('w'); for (let i = 0; i < 24; i++) await page.waitForTimeout(50); await page.keyboard.up('w');
await page.waitForTimeout(500);
const buf = await page.screenshot({ path: 'test/screenshots/real-landing.png' });
await browser.close(); server.close();
console.log(JSON.stringify({ biome: info.biome, bytes: buf.length, errors: errors.slice(0, 3) }));
console.log('LAND SHOT DONE');
