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
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=space`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(4000);
const heading = () => page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const f = s.shipCtl.forward;
  return Math.round((Math.atan2(f.x, f.z) * 180 / Math.PI + 360) % 360);
});
console.log('heading before:', await heading());
await page.screenshot({ path: 'test/screenshots/turn-0.png' });
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyD');   // just W + D, nothing else
await page.waitForTimeout(1800);
console.log('heading during D:', await heading());
await page.screenshot({ path: 'test/screenshots/turn-1.png' });
await page.waitForTimeout(1800);
console.log('heading later:', await heading());
await page.screenshot({ path: 'test/screenshots/turn-2.png' });
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyW');
await browser.close(); server.close();
