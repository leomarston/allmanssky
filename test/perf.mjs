// Render-stat audit: draw calls, triangles, resource counts per game state.
// (Headless FPS is SwiftShader software rendering — directional only.)
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

for (const url of ['/index.html?state=surface&biome=lush&tod=0.15', '/index.html?state=space']) {
  await page.goto(`http://127.0.0.1:${server.address().port}${url}`);
  await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
  await page.waitForTimeout(8000);
  const stats = await page.evaluate(async () => {
    const g = window.__AMS__.game;
    const info = g.engine.renderer.info;
    info.autoReset = false;
    info.reset();
    const t0 = performance.now();
    let frames = 0;
    await new Promise((res) => {
      const tick = () => {
        frames++;
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    const out = {
      state: g.state.name,
      fpsSwiftshader: Math.round(frames / 3),
      drawCallsPerFrame: Math.round(info.render.calls / frames),
      trianglesPerFrame: Math.round(info.render.triangles / frames),
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs.length,
    };
    info.autoReset = true;
    return out;
  });
  console.log(JSON.stringify(stats));
}
await browser.close();
server.close();
