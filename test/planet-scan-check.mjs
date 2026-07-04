// Scan/discovery check for the seamless planet (?state=planet). Teleports to a
// fauna-rich sunlit spot, disembarks, walks so creatures stream in, then scans
// (both via the real V key path and a direct call) and asserts that a lifeform
// discovery banked and the "scan N lifeforms" quest counter (stats.creatures
// Scanned) advanced, with no page errors. Usage: node test/planet-scan-check.mjs
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`http://127.0.0.1:${port}/index.html?state=planet`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'planet', { timeout: 30000 });
await page.waitForTimeout(500);

await page.evaluate(() => {
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
  const groundR = s.planet.heightAt(best);
  s.playerUniPos.copy(best).multiplyScalar(groundR + 150);
  s.shipVel.set(0, 0, 0);
});
await page.waitForTimeout(1400);
await page.evaluate(() => window.__AMS__.game.state.disembark());
await page.keyboard.down('w');
for (let i = 0; i < 30; i++) await page.waitForTimeout(50);
await page.keyboard.up('w');
await page.waitForTimeout(400);

const pre = await page.evaluate(() => {
  const gs = window.__AMS__.game.gameState;
  return { creaturesScanned: gs.stats.creaturesScanned ?? 0, lumens: gs.lumens ?? 0, fauna: window.__AMS__.game.state.fauna?.creatures?.length ?? 0 };
});

// real key path: press V (scan). fire cooldown then reset for the direct call.
await page.keyboard.down('v');
await page.waitForTimeout(120);
await page.keyboard.up('v');
await page.waitForTimeout(200);

// direct call too (belt and suspenders — resets cooldown first), to guarantee a
// scan runs even if the single-frame edge of the keypress was missed.
const res = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const gs = window.__AMS__.game.gameState;
  s._scanCd = 0;
  s._scan(gs);
  // NaN guard on the player transform after scanning
  let anyNaN = !Number.isFinite(s.playerUniPos.x + s.playerUniPos.y + s.playerUniPos.z);
  return {
    creaturesScanned: gs.stats.creaturesScanned ?? 0,
    lumens: gs.lumens ?? 0,
    scanCd: s._scanCd, anyNaN,
    // a second scan of the same nearest creature should NOT double-count
    secondScanCd: (() => { s._scanCd = 0; s._scan(gs); return s._scanCd; })(),
    afterSecond: gs.stats.creaturesScanned ?? 0,
  };
});

await browser.close();
server.close();

const realErrors = errors.filter((e) => !/favicon/i.test(e));
const out = {
  errors: realErrors.slice(0, 10),
  pre, post: res,
  scannedGained: res.creaturesScanned - pre.creaturesScanned,
  lumensGained: res.lumens - pre.lumens,
  cooldownSet: res.scanCd > 0,
  noDoubleCount: res.afterSecond === res.creaturesScanned,
};
console.log(JSON.stringify(out, null, 2));
if (realErrors.length || res.anyNaN || out.scannedGained <= 0 || !out.cooldownSet || !out.noDoubleCount) {
  console.error('PLANET-SCAN CHECK FAILED');
  process.exit(1);
}
console.log('PLANET-SCAN CHECK PASSED');
