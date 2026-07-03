// Regression test for mouse capture: boot the game, CLICK the viewport like a
// player would, and assert pointer lock actually engaged on the canvas.
// (Would have caught the #ui-root > * specificity bug that ate canvas clicks.)
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

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

let pass = true;
for (const state of ['space', 'surface']) {
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=${state}&tod=0.2`);
  await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
  await page.waitForTimeout(3000);

  // the element a player's click actually lands on at screen center
  const topEl = await page.evaluate(() => {
    const e = document.elementFromPoint(640, 400);
    return e ? `${e.tagName.toLowerCase()}#${e.id || ''}.${e.className?.baseVal ?? e.className ?? ''}` : 'null';
  });

  await page.mouse.click(640, 400);
  await page.waitForTimeout(600);
  const locked = await page.evaluate(() => document.pointerLockElement?.id ?? null);
  const hintGone = await page.evaluate(() =>
    ![...document.querySelectorAll('#ui-root div')]
      .some((d) => d.textContent === 'CLICK TO TAKE CONTROL' && d.style.display !== 'none'));

  const ok = locked === 'game-canvas' && hintGone;
  pass &&= ok;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${state}: click target=${topEl} → pointerLockElement=${locked} hintHidden=${hintGone}`);
}

await browser.close();
server.close();
if (errors.length) { console.log('page errors:', errors.slice(0, 5)); pass = false; }
console.log(pass ? 'LOCK CHECK PASSED' : 'LOCK CHECK FAILED');
process.exit(pass ? 0 : 1);
