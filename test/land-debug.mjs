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
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
page.on('pageerror', (e) => console.log('PAGEERR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=surface&biome=lush&tod=0.2`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(3000);
// board and rise first (mirrors real play), then land
await page.evaluate(() => window.__AMS__.game.state._boardShip());
await page.waitForFunction(() => window.__AMS__.game.state.mode === 'ship', { timeout: 30000 });
console.log('flying OK');
await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const g = s.shipObj.group.position;
  g.y = s.field.height(g.x, g.z) + 40;
  s._requestLanding();
});
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(() => {
    const s = window.__AMS__.game.state;
    return { mode: s.mode, autoT: s.auto?.t?.toFixed(2), dur: s.auto?.dur?.toFixed(2), y: s.shipObj.group.position.y.toFixed(1) };
  });
  console.log(JSON.stringify(st));
  if (st.mode === 'seated') break;
}
await browser.close(); server.close();
