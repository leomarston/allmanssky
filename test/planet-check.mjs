// Headless descent check for the PlanetSphere prototype.
// Serves the repo, loads test/pages/planet.html in SwiftShader Chromium, jumps
// the scripted descent to three fractions via window.__PLANET__.setT(), screen-
// shots each, and asserts zero page/console errors + non-black frames.
// Usage: node test/planet-check.mjs
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

await page.goto(`http://127.0.0.1:${port}/test/pages/planet.html`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
await page.waitForFunction(() => !!window.__PLANET__, { timeout: 30000 });

const shots = [
  { t: 0.0, name: 'planet-orbit' },
  { t: 0.6, name: 'planet-mid' },
  { t: 0.98, name: 'planet-surface' },
];

const results = [];
for (const s of shots) {
  await page.evaluate((t) => window.__PLANET__.setT(t), s.t);
  // let a couple of frames settle so any splits triggered by the jump build
  await page.waitForTimeout(700);
  await page.evaluate((t) => window.__PLANET__.setT(t), s.t);
  await page.waitForTimeout(300);
  const stats = await page.evaluate(() => window.__PLANET__.planet.getStats());
  const buf = await page.screenshot({ path: `test/screenshots/${s.name}.png` });
  results.push({ ...s, pngBytes: buf.length, litLikely: buf.length > 20000, stats });
}

await browser.close();
server.close();

const realErrors = errors.filter((e) => !/favicon/i.test(e));
console.log(JSON.stringify({ errors: realErrors.slice(0, 12), results }, null, 2));
const allLit = results.every((r) => r.litLikely);
if (realErrors.length || !allLit) {
  console.error('PLANET CHECK FAILED');
  process.exit(1);
}
console.log('PLANET CHECK PASSED');
