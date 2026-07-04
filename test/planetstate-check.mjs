// In-game seamless-planet check.
// Boots the REAL app at ?state=planet in SwiftShader Chromium, asserts a clean
// boot (no page/console errors), screenshots orbit, drives the craft down near
// the surface (state.placeAtAGL) and screenshots the descent, then disembarks
// (state.disembark) and simulates a few walk frames — asserting the on-foot
// player stays glued at ~eye-height above heightAt (never falls through / flies
// off) — and screenshots the walk. Saves test/screenshots/planet-ingame-*.png.
// Usage: node test/planetstate-check.mjs
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
  args: [
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', '--use-angle=swiftshader',
    '--disable-gpu-sandbox', '--no-sandbox',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('pageerror', (err) => errors.push(String(err)));

await page.goto(`http://127.0.0.1:${port}/index.html?state=planet`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'planet', { timeout: 30000 });

const out = { errors: [], shots: [], checks: {} };

// --- 1) orbit -----------------------------------------------------------------
await page.waitForTimeout(900);           // let the LOD settle a couple of frames
const orbit = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  return { mode: s.mode, agl: Math.round(s.agl), stats: s.planet.getStats() };
});
let buf = await page.screenshot({ path: 'test/screenshots/planet-ingame-orbit.png' });
out.shots.push({ name: 'orbit', bytes: buf.length, ...orbit });

// --- 2) descend near the surface ---------------------------------------------
await page.evaluate(() => window.__AMS__.game.state.placeAtAGL(150));
await page.waitForTimeout(1400);          // near-field chunks build during descent
const descent = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  return { mode: s.mode, agl: Math.round(s.agl), stats: s.planet.getStats() };
});
buf = await page.screenshot({ path: 'test/screenshots/planet-ingame-descent.png' });
out.shots.push({ name: 'descent', bytes: buf.length, ...descent });

// --- 3) seamless disembark + walk --------------------------------------------
await page.evaluate(() => window.__AMS__.game.state.disembark());
await page.waitForTimeout(400);           // settle onto the ground
// walk forward for a bit — WASD works without pointer lock (reads key state)
await page.keyboard.down('w');
const aglSamples = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(50);
  aglSamples.push(await page.evaluate(() => window.__AMS__.game.state.agl));
}
await page.keyboard.up('w');
await page.waitForTimeout(150);

const foot = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  return { mode: s.mode, agl: s.agl, onGround: s.onGround, stats: s.planet.getStats() };
});
buf = await page.screenshot({ path: 'test/screenshots/planet-ingame-foot.png' });
out.shots.push({ name: 'foot', bytes: buf.length, mode: foot.mode, agl: Math.round(foot.agl * 100) / 100, onGround: foot.onGround, stats: foot.stats });

// glued-to-surface invariant: eye stays ~EYE_HEIGHT (1.7) above terrain.
const EYE = 1.7;
const gluedOk = aglSamples.every((a) => a > EYE - 0.8 && a < EYE + 1.6);
const minA = Math.min(...aglSamples).toFixed(3);
const maxA = Math.max(...aglSamples).toFixed(3);
out.checks = {
  onFoot: foot.mode === 'foot',
  onGround: foot.onGround === true,
  gluedOk,
  aglRange: `${minA}..${maxA}`,
  litAll: out.shots.every((s) => s.bytes > 20000),
};

await browser.close();
server.close();

out.errors = errors.filter((e) => !/favicon/i.test(e)).slice(0, 12);
console.log(JSON.stringify(out, null, 2));

const c = out.checks;
if (out.errors.length || !c.onFoot || !c.onGround || !c.gluedOk || !c.litAll) {
  console.error('PLANET-INGAME CHECK FAILED');
  process.exit(1);
}
console.log('PLANET-INGAME CHECK PASSED');
