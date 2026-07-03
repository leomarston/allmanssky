import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = '/home/user/allmanssky';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const data = await readFile(join(root, p === '/' ? '/index.html' : p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=surface&biome=lush&tod=0.14`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(4000);
await page.evaluate(() => window.__AMS__.game.state._boardShip());
await page.waitForFunction(() => window.__AMS__.game.state.mode === 'ship', { timeout: 30000 });
await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const g = s.shipObj.group.position;
  g.y = s.field.height(g.x, g.z) + 120;
  s.shipCtl.throttle = 0.7;
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(7000);
await page.screenshot({ path: 'test/screenshots/flight-over-terrain.png' });
await page.keyboard.up('KeyW');
await browser.close(); server.close();
console.log('done');
