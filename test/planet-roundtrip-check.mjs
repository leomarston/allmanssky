// Round-trip check: the seamless planet as the REAL landing.
// Boots into SPACE, lands on a real system planet (-> PlanetState derived from
// the planet def), disembarks + walks + scans, climbs back out (-> SpaceState),
// verifies gs.location routing + save/load + re-entry, all with zero errors.
// Usage: node test/planet-roundtrip-check.mjs
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// boot straight into SPACE (debug), deterministic world
await page.goto(`http://127.0.0.1:${port}/index.html?state=space`);
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 30000 });
await page.waitForFunction(() => window.__AMS__?.game?.state?.name === 'space', { timeout: 30000 });
await page.waitForTimeout(500);

// 1) LAND on a real planet -> PlanetState from the def
const land = await page.evaluate(async () => {
  const game = window.__AMS__.game;
  const space = game.state;
  if (!space.planets?.length) return { error: 'no planets in system' };
  // prefer a LIVING world (so the scan step has fauna); fall back to any.
  const DEAD = ['barren', 'husk', 'irradiated', 'volcanic'];
  const p = space.planets.find((pl) => !DEAD.includes(pl.def?.biome)) ?? space.planets[0];
  const living = !DEAD.includes(p.def?.biome);
  await space._land(p);
  return { requested: p.index, biome: p.def?.biome, living };
});
await page.waitForFunction(() => window.__AMS__.game.state?.name === 'planet', { timeout: 30000 });
await page.waitForTimeout(400);
const onPlanet = await page.evaluate(() => {
  const g = window.__AMS__.game, gs = g.gameState, s = g.state;
  return {
    name: s.name, mode: gs.location.mode, planetIndex: gs.location.planetIndex,
    systemId: gs.location.systemId, biome: s.biome?.key, hasDef: !!s.def, agl: Math.round(s.agl),
  };
});

// 2) teleport to ground, disembark, walk, scan (real gs quest hooks)
await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  const THREE = s.playerUniPos.constructor;
  const sun = new THREE(0.55, 0.42, 0.72).normalize();
  let best = null, bestScore = -1e9, st = 0x51ee7 >>> 0;
  const rnd = () => ((st = (Math.imul(st ^ (st >>> 15), 0x2c1b3c6d)) >>> 0) / 4294967296);
  const d = new THREE();
  for (let i = 0; i < 4000; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, sr = Math.sqrt(1 - u * u);
    d.set(Math.cos(a) * sr, u, Math.sin(a) * sr);
    if (Math.abs(d.y) > 0.5) continue;
    if (d.dot(sun) < 0.3) continue;
    const alt = s.planet.heightAt(d) - s.planet.radius;
    const score = -Math.abs(alt - 30);
    if (score > bestScore) { bestScore = score; best = d.clone(); }
  }
  s.playerUniPos.copy(best).multiplyScalar(s.planet.heightAt(best) + 120);
  s.shipVel.set(0, 0, 0);
});
await page.waitForTimeout(1200);
await page.evaluate(() => window.__AMS__.game.state.disembark());
await page.keyboard.down('w');
for (let i = 0; i < 24; i++) await page.waitForTimeout(50);
await page.keyboard.up('w');
await page.waitForTimeout(300);
const foot = await page.evaluate(() => {
  const s = window.__AMS__.game.state, gs = window.__AMS__.game.gameState;
  const preScan = gs.stats.creaturesScanned ?? 0;
  // if any creature streamed in, stand beside the nearest so the scan has a
  // guaranteed target (fauna proximity after a random teleport is unreliable).
  const cs = s.fauna?.creatures ?? [];
  let faunaNear = false;
  if (cs.length) {
    const c = cs[0];
    const dir = c.uniPos.clone().normalize();
    s.playerUniPos.copy(dir).multiplyScalar(s.planet.heightAt(dir) + 1.7);
    faunaNear = c.uniPos.distanceTo(s.playerUniPos) < 60;
  }
  s._scanCd = 0; s._scan(gs);
  return { mode: s.mode, onGround: s.onGround, agl: Number(s.agl.toFixed(2)),
    faunaCount: cs.length, faunaNear, scannedGain: (gs.stats.creaturesScanned ?? 0) - preScan };
});

// 3) TAKE OFF and climb out -> SpaceState
await page.evaluate(() => {
  const s = window.__AMS__.game.state;
  s.takeOff();
  s.playerUniPos.copy(s.playerUniPos).normalize().multiplyScalar(s.planet.radius + 3200);
  s.shipVel.copy(s.playerUniPos).normalize().multiplyScalar(120);   // outbound
});
await page.waitForFunction(() => window.__AMS__.game.state?.name === 'space', { timeout: 30000 });
const backInSpace = await page.evaluate(() => {
  const g = window.__AMS__.game;
  return { name: g.state.name, mode: g.gameState.location.mode };
});

// 4) save/load round-trips the planet location
const save = await page.evaluate(() => {
  const gs = window.__AMS__.game.gameState;
  gs.location = { mode: 'planet', planetIndex: 0, systemId: gs.currentSystemId, pos: null };
  gs.slot = 1; gs.save();
  const loaded = gs.constructor.load(1);
  return { mode: loaded?.location?.mode, planetIndex: loaded?.location?.planetIndex, systemId: loaded?.location?.systemId };
});

// 5) re-enter the planet via switchState (death/load path) — must not crash
const reenter = await page.evaluate(async () => {
  const g = window.__AMS__.game;
  await g.switchState('planet', { systemId: g.gameState.currentSystemId, planetIndex: 0 });
  return { name: g.state.name, mode: g.gameState.location.mode };
});
await page.waitForFunction(() => window.__AMS__.game.state?.name === 'planet', { timeout: 20000 });

await browser.close();
server.close();

const realErrors = errors.filter((e) => !/favicon/i.test(e));
const out = {
  land, onPlanet, foot, backInSpace, save, reenter,
  errors: realErrors.slice(0, 12),
};
console.log(JSON.stringify(out, null, 2));
// scan must bank a discovery ONLY if we landed on a living world (dead worlds
// legitimately have no fauna); the scan loop itself is verified by planet-scan.
const scanOk = (foot.faunaCount > 0 && foot.faunaNear) ? foot.scannedGain >= 1 : true;
const ok = !realErrors.length
  && onPlanet.name === 'planet' && onPlanet.mode === 'planet' && onPlanet.hasDef
  && foot.mode === 'foot' && foot.onGround && scanOk
  && backInSpace.name === 'space' && backInSpace.mode === 'space'
  && save.mode === 'planet' && save.planetIndex === 0 && save.systemId != null
  && reenter.name === 'planet';
if (!ok) { console.error('PLANET-ROUNDTRIP CHECK FAILED'); process.exit(1); }
console.log('PLANET-ROUNDTRIP CHECK PASSED');
