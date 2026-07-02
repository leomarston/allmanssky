// End-to-end journey test: menu → new voyage → space → land on planet →
// surface → takeoff → space → warp. Exercises state transitions and disposal.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const data = await readFile(join(root, p === '/' ? '/index.html' : p));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGE: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon/i.test(m.text())) errors.push(`CONSOLE: ${m.text()}`);
});

const shot = (name) => page.screenshot({ path: `test/screenshots/journey-${name}.png` });
const step = async (name, fn) => {
  const before = errors.length;
  await fn();
  await shot(name);
  const ok = errors.length === before;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ' — ' + errors.slice(before).join(' | ').slice(0, 300)}`);
  return ok;
};

let pass = true;

// 1. main menu
await page.goto(`http://127.0.0.1:${port}/index.html`);
pass &= await step('menu', async () => {
  await page.waitForTimeout(3500);
});

// 2. start a new voyage from the menu
pass &= await step('newgame', async () => {
  const btn = page.locator('button, .ams-btn').filter({ hasText: /new voyage/i }).first();
  if (await btn.count()) await btn.click();
  else await page.keyboard.press('Enter');
  // seed prompt may appear — press Enter / click begin
  await page.waitForTimeout(800);
  const begin = page.locator('button, .ams-btn').filter({ hasText: /begin|launch|start|embark/i }).first();
  if (await begin.count()) await begin.click().catch(() => {});
  await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(6000);
});

// 3. verify space state, then land programmatically (input-driven landing needs
//    real flight; the transition path is what we're testing)
pass &= await step('space', async () => {
  const state = await page.evaluate(() => window.__AMS__?.game?.state?.name);
  if (state !== 'space') errors.push(`CONSOLE: expected space state, got ${state}`);
});

pass &= await step('land-on-planet', async () => {
  await page.evaluate(async () => {
    const g = window.__AMS__.game;
    const space = g.state;
    const p = space.planets.find((x) => x.def.biome === 'lush') ?? space.planets[0];
    await g.switchState('surface', {
      systemId: space.systemId,
      planetIndex: p.index,
      landingPos: { x: 120, z: -60 },
    });
  });
  await page.waitForTimeout(9000);
});

// 4. verify surface state + walk forward a moment
pass &= await step('surface-walk', async () => {
  const state = await page.evaluate(() => window.__AMS__?.game?.state?.name);
  if (state !== 'surface') errors.push(`CONSOLE: expected surface state, got ${state}`);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2500);
  await page.keyboard.up('KeyW');
});

// 5. open + close inventory
pass &= await step('inventory', async () => {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1200);
});
pass &= await step('inventory-close', async () => {
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);
});

// 6. takeoff back to space (programmatic — same code path as F at the ship)
pass &= await step('takeoff', async () => {
  await page.evaluate(async () => {
    const g = window.__AMS__.game;
    await g.state._takeoff();
  });
  await page.waitForTimeout(8000);
  const state = await page.evaluate(() => window.__AMS__?.game?.state?.name);
  if (state !== 'space') errors.push(`CONSOLE: expected space after takeoff, got ${state}`);
});

// 7. warp to a neighbor system
pass &= await step('warp', async () => {
  await page.evaluate(async () => {
    const g = window.__AMS__.game;
    g.gameState.ship.warpCells = Math.max(1, g.gameState.ship.warpCells);
    await g.state._tryWarp();
  });
  await page.waitForTimeout(9000);
  const sys = await page.evaluate(() => window.__AMS__?.game?.state?.system?.name);
  if (!sys) errors.push('CONSOLE: no system after warp');
  else console.log('  warped to:', sys);
});

await browser.close();
server.close();
console.log(pass ? 'JOURNEY PASSED' : 'JOURNEY FAILED');
process.exit(pass ? 0 : 1);
