import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=space`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const g = window.__AMS__.game;
  g.gameState.addLumens(3000);
  g.gameState.addItem('voltglass', 8);
  g.gameState.addItem('solanite', 8);
  g.gameState.addItem('weavecircuit', 6);
  g.gameState.ship.hull = 40;
  g.ui.trade.open(g.state.system);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/screenshots/trade-commodities.png' });
await page.evaluate(() => document.querySelectorAll('.tr-tab')[2].click());
await page.waitForTimeout(600);
await page.screenshot({ path: 'test/screenshots/trade-upgrades.png' });
// buy an upgrade
const before = await page.evaluate(() => window.__AMS__.game.gameState.upgrades.shipSpeed);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('#tr-body button')];
  btns.find((b) => b.textContent.includes('⌾'))?.click();
});
const after = await page.evaluate(() => window.__AMS__.game.gameState.upgrades.shipSpeed);
console.log('upgrade purchase: shipSpeed', before, '→', after);
await browser.close(); server.close();
console.log(JSON.stringify({ errors: errors.slice(0, 6) }));
console.log(errors.length ? 'TRADE CHECK ERRORS' : 'TRADE CHECK PASSED');
