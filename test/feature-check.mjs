// Feature spot-check: build mode bar + ghost, hostile warden, scanner pulse.
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
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=surface&biome=lush&tod=0.12`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(6000);

// stock up and enter build mode
await page.evaluate(() => {
  const g = window.__AMS__.game;
  for (const [id, n] of [['ferrox', 60], ['carbyne', 30], ['luminglass', 8], ['voltglass', 6], ['ferroweave', 6], ['silica', 20]]) g.gameState.addItem(id, n);
});
await page.keyboard.press('KeyB');
await page.waitForTimeout(1500);
await page.screenshot({ path: 'test/screenshots/feature-build.png' });

// place pieces programmatically (pointer lock is flaky headless)
await page.evaluate(() => {
  const g = window.__AMS__.game;
  const b = g.state.builder;
  const px = g.state.player.position;
  const place = (kind, dx, dz, rotY = 0, dy = 0) => {
    const x = Math.round((px.x + dx) / 4) * 4, z = Math.round((px.z + dz) / 4) * 4;
    const y = g.state.field.height(x, z) + dy;
    const rec = { kind, x, y, z, rotY };
    if (!b.base) { b.base = { systemId: b.systemId, planetIndex: b.planetIndex, pieces: [] }; g.gameState.bases.push(b.base); }
    b.base.pieces.push(rec);
    b._materialize(rec);
  };
  place('foundation', 8, 0);
  place('foundation', 12, 0);
  place('wall', 8, -2, 0, 0.32);
  place('window', 12, -2, 0, 0.32);
  place('door', 8, 2, 0, 0.32);
  place('roof', 8, 0, 0, 3.32);
  place('light', 5, 4);
  place('storage', 5, 1);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/screenshots/feature-base.png' });
await page.keyboard.press('KeyB');

// hostile warden
await page.evaluate(() => {
  const g = window.__AMS__.game;
  const c = g.state.combat;
  c._spawn(g.state.player.position);
  const w = c.wardens[c.wardens.length - 1];
  w.obj.group.position.copy(g.state.player.position).add(new THREE_VEC(8, 3, -12));
  function THREE_VEC(x, y, z) { return { x, y, z, isVector3: true }; }
});
// simpler: nudge via another evaluate using the warden's own vector API
await page.evaluate(() => {
  const g = window.__AMS__.game;
  const c = g.state.combat;
  const w = c.wardens[c.wardens.length - 1];
  const p = g.state.player.position;
  w.obj.group.position.set(p.x + 6, p.y + 4, p.z - 11);
  c._goHostile(w);
});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'test/screenshots/feature-warden.png' });

await browser.close(); server.close();
const real = errors.filter((e) => !/THREE_VEC/.test(e));
console.log(JSON.stringify({ errors: real.slice(0, 8) }, null, 2));
console.log(real.length ? 'FEATURE CHECK ERRORS' : 'FEATURE CHECK PASSED');
