// Render each biome via test/pages/planet.html?biome=<key> at a low descent
// altitude and screenshot to test/screenshots/biome-<key>.png. Visual check that
// the biome system produces distinct worlds. Usage: node test/biome-shots.mjs
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

const biomes = ['lush', 'desert', 'frozen', 'toxic', 'scorched', 'barren', 'exotic', 'ocean'];
const out = [];
for (const b of biomes) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${port}/test/pages/planet.html?biome=${b}`);
  await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
  await page.waitForFunction(() => !!window.__PLANET__, { timeout: 30000 });
  await page.evaluate((t) => window.__PLANET__.setT(t), 0.9);
  await page.waitForTimeout(1400);
  await page.evaluate((t) => window.__PLANET__.setT(t), 0.9);
  await page.waitForTimeout(700);
  const buf = await page.screenshot({ path: `test/screenshots/biome-${b}.png` });
  out.push({ biome: b, bytes: buf.length, lit: buf.length > 30000, errors: errors.slice(0, 3) });
  await page.close();
}
await browser.close();
server.close();
console.log(JSON.stringify(out, null, 2));
const bad = out.filter((o) => !o.lit || o.errors.length);
if (bad.length) { console.error('BIOME SHOTS FAILED:', JSON.stringify(bad)); process.exit(1); }
console.log('BIOME SHOTS OK');
