// Headless smoke test: boots the game in Chromium (SwiftShader WebGL),
// waits for the engine, screenshots, and fails on console errors.
// Usage: node test/smoke.mjs [url-path] [screenshot-name] [waitMs]
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const urlPath = process.argv[2] || '/index.html';
const shotName = process.argv[3] || 'smoke';
const waitMs = Number(process.argv[4] || 4000);

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
  } catch {
    res.writeHead(404); res.end('not found');
  }
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

await page.goto(`http://127.0.0.1:${port}${urlPath}`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(waitMs);

const ready = await page.evaluate(() => !!window.__AMS__?.ready);
const shot = await page.screenshot({ path: `test/screenshots/${shotName}.png` });

// non-black sanity check on the PNG bytes: a rendered scene compresses far
// larger than a solid black frame (~5 KB at 1280x720)
const stats = { pngBytes: shot.length, litLikely: shot.length > 20000 };

await browser.close();
server.close();

const realErrors = errors.filter((e) => !/favicon/i.test(e));
console.log(JSON.stringify({ ready, errors: realErrors.slice(0, 12), stats }, null, 2));
if (!ready || realErrors.length || !stats.litLikely) {
  console.error('SMOKE TEST FAILED');
  process.exit(1);
}
console.log('SMOKE TEST PASSED');
