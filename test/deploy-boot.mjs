import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
await page.goto('http://127.0.0.1:8124/index.html?state=space');
await page.waitForFunction(() => window.__AMS__?.ready, { timeout: 40000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: 'test/screenshots/deploy-server.png' });
await browser.close();
console.log(JSON.stringify({ ready: true, errors: errors.slice(0, 6) }));
console.log(errors.length ? 'DEPLOY SERVER BOOT FAILED' : 'DEPLOY SERVER BOOT PASSED');
