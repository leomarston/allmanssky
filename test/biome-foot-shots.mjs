// On-foot screenshots of specific biomes via ?state=planet&biome=<key>.
// Teleports to a sunlit low spot, disembarks, walks so cover streams, shoots.
// Usage: node test/biome-foot-shots.mjs [biome1 biome2 ...]  (default desert barren lush)
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.wasm': 'application/wasm' };
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
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--no-sandbox'],
});

const biomes = process.argv.slice(2).length ? process.argv.slice(2) : ['desert', 'barren', 'lush'];
const out = [];
for (const b of biomes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/index.html?state=planet&biome=${b}`);
  await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
  await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'planet', { timeout: 30000 });
  await page.waitForTimeout(500);
  // teleport to a sunlit, non-polar, low spot
  await page.evaluate(() => {
    const s = window.__AMS__.game.state;
    const THREE = s.playerUniPos.constructor;
    const sun = new THREE(0.55, 0.42, 0.72).normalize();
    let best = null, bestScore = -1e9, st = 0x2c9a3b1d >>> 0;
    const rnd = () => ((st = (Math.imul(st ^ (st >>> 15), 0x2c1b3c6d)) >>> 0) / 4294967296);
    const d = new THREE();
    for (let i = 0; i < 4000; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
      d.set(Math.cos(a) * sr, u, Math.sin(a) * sr);
      if (Math.abs(d.y) > 0.45) continue;
      if (d.dot(sun) < 0.4) continue;
      const alt = s.planet.heightAt(d) - s.planet.radius;
      const score = -Math.abs(alt - 40);
      if (score > bestScore) { bestScore = score; best = d.clone(); }
    }
    const gR = s.planet.heightAt(best);
    s.playerUniPos.copy(best).multiplyScalar(gR + 120);
    s.shipVel.set(0, 0, 0);
  });
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.__AMS__.game.state.disembark());
  await page.keyboard.down('w');
  for (let i = 0; i < 26; i++) await page.waitForTimeout(50);
  await page.keyboard.up('w');
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const s = window.__AMS__.game.state;
    return { biome: s.biome?.key, grass: s.scatter?._grass?.count ?? -1, plant: s.scatter?._plant?.count ?? -1, rock: s.scatter?._rock?.count ?? -1 };
  });
  const buf = await page.screenshot({ path: `test/screenshots/biome-foot-${b}.png` });
  out.push({ biome: b, ...info, bytes: buf.length, lit: buf.length > 30000, errors: errors.slice(0, 2) });
  await page.close();
}
await browser.close();
server.close();
console.log(JSON.stringify(out, null, 2));
console.log('BIOME FOOT SHOTS DONE');
