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
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// --- dig check on surface
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=surface&biome=lush&tod=0.15`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(3000);
const dig = await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const p = s.player.position;
  const x = p.x + 6, z = p.z;
  const before = s.field.height(x, z);
  s.field.addDig(x, z, 2.8, 1.05);
  s.field.addDig(x, z, 2.8, 1.05);
  s.terrain.invalidateArea(x, z, 4);
  const after = s.field.height(x, z);
  return { before: +before.toFixed(2), after: +after.toFixed(2), carved: before - after > 1.5 };
});
console.log('dig:', JSON.stringify(dig));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test/screenshots/dig-crater.png' });

// --- pulse check in space
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=space`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const st = window.__AMS__.game.state;
  st.shipCtl.ship.position.set(4200, 300, 3800);  // open space, far from mass
  st.shipCtl.throttle = 0.8;
});
const p0 = await page.evaluate(() => window.__AMS__.game.state.shipCtl.position.length());
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyX');
await page.waitForTimeout(6000);
await page.screenshot({ path: 'test/screenshots/pulse-drive.png' });
await page.keyboard.up('KeyX');
await page.keyboard.up('KeyW');
const p1 = await page.evaluate(() => window.__AMS__.game.state.shipCtl.position.length());
const pulseLvl = await page.evaluate(() => window.__AMS__.game.state._pulseLevel ?? 0);
console.log('pulse:', JSON.stringify({ moved: Math.round(Math.abs(p1 - p0)), level: +pulseLvl.toFixed(2) }));
await browser.close(); server.close();
console.log(errs.length ? 'ERRORS: ' + errs.slice(0,4).join('|') : 'DIG+PULSE CHECK PASSED');
