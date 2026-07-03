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
  // seed screen: click Launch
  await page.waitForTimeout(700);
  const launch = page.locator('button, .ams-btn').filter({ hasText: /^launch$|begin|embark/i }).first();
  if (await launch.count()) await launch.click().catch(() => {});
  // slot picker: pick the first slot (empty or overwrite)
  await page.waitForTimeout(700);
  const slot = page.locator('button, .ams-btn').filter({ hasText: /slot 1/i }).first();
  if (await slot.count()) await slot.click().catch(() => {});
  await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(6000);
});

// 3. verify space state, then land programmatically (input-driven landing needs
//    real flight; the transition path is what we're testing)
pass &= await step('space', async () => {
  const state = await page.evaluate(() => window.__AMS__?.game?.state?.name);
  if (state !== 'space') errors.push(`CONSOLE: expected space state, got ${state}`);
});

pass &= await step('atmospheric-entry', async () => {
  await page.evaluate(async () => {
    const g = window.__AMS__.game;
    const space = g.state;
    const p = space.planets.find((x) => x.def.biome === 'lush') ?? space.planets[0];
    await g.switchState('surface', {
      systemId: space.systemId,
      planetIndex: p.index,
      arrive: 'entry',
      landingPos: { x: 120, z: -60 },
    });
  });
  await page.waitForTimeout(9000);
  const mode = await page.evaluate(() => window.__AMS__?.game?.state?.mode);
  if (mode !== 'ship') errors.push(`CONSOLE: expected flight after entry, got mode=${mode}`);
});

// 4. fly down and land on the skids (poll: headless software GL runs ~3 fps,
// so scripted-time animations take many real seconds)
pass &= await step('land', async () => {
  await page.evaluate(() => {
    const s = window.__AMS__.game.state;
    const g = s.shipObj.group.position;
    // find dry ground (landing on water is refused), then descend and land
    const sea = Number.isFinite(s.field.seaY) ? s.field.seaY : -Infinity;
    for (let r = 0; r < 2000; r += 60) {
      const x = g.x + r, z = g.z + (r % 120);
      if (s.field.height(x, z) > sea + 1) { g.x = x; g.z = z; break; }
    }
    g.y = s.field.height(g.x, g.z) + 40;
    s._requestLanding();
  });
  await page.waitForFunction(() => window.__AMS__?.game?.state?.mode === 'seated', { timeout: 45000 })
    .catch(async () => errors.push(`CONSOLE: expected seated after landing, got mode=${await page.evaluate(() => window.__AMS__?.game?.state?.mode)}`));
});

// 5. disembark + walk
pass &= await step('surface-walk', async () => {
  await page.evaluate(() => window.__AMS__.game.state._exitShip());
  await page.waitForTimeout(800);
  const mode = await page.evaluate(() => window.__AMS__?.game?.state?.mode);
  if (mode !== 'foot') errors.push(`CONSOLE: expected foot after exit, got mode=${mode}`);
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

// 6. board, hover-takeoff, climb out of the atmosphere into space
pass &= await step('takeoff', async () => {
  await page.evaluate(() => window.__AMS__.game.state._boardShip());
  await page.waitForFunction(() => window.__AMS__?.game?.state?.mode === 'ship', { timeout: 45000 })
    .catch(async () => errors.push(`CONSOLE: expected flight after takeoff, got mode=${await page.evaluate(() => window.__AMS__?.game?.state?.mode)}`));
  // climb past the atmosphere ceiling
  await page.evaluate(() => { window.__AMS__.game.state.shipObj.group.position.y += 700; });
  await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'space', { timeout: 60000 })
    .catch(async () => errors.push(`CONSOLE: expected space after climb-out, got ${await page.evaluate(() => window.__AMS__?.game?.state?.name)}`));
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
