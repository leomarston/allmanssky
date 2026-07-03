import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root = '/home/user/allmanssky';
const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css' };
const server = createServer(async (req,res)=>{ try {
  const p = decodeURIComponent(new URL(req.url,'http://x').pathname);
  const d = await readFile(join(root, p==='/'?'/index.html':p));
  res.writeHead(200,{'Content-Type':MIME[extname(p)]||'application/octet-stream'}); res.end(d);
} catch { res.writeHead(404); res.end(); } });
await new Promise(r=>server.listen(0,r));
const browser = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox'] });
const page = await browser.newPage({ viewport:{width:1280,height:720} });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
page.on('console',m=>{ if(m.type()==='error'&&!/favicon/.test(m.text())) errs.push(m.text()); });
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=space`);
await page.waitForFunction(()=>window.__AMS__?.ready,{timeout:40000});
await page.waitForTimeout(4000);
// open photo mode via the real key
await page.keyboard.press('KeyP');
await page.waitForTimeout(600);
const open1 = await page.evaluate(()=>window.__AMS__.game.photo.isOpen);
// fly the free camera up/forward and tweak FOV via the camera directly
await page.keyboard.down('KeyW'); await page.keyboard.down('Space');
await page.waitForTimeout(1200);
await page.keyboard.up('KeyW'); await page.keyboard.up('Space');
const flew = await page.evaluate(()=>{
  const p = window.__AMS__.game.photo;
  return { hasCam: !!p.cam, y: p.cam ? +p.cam.position.y.toFixed(1) : null };
});
await page.screenshot({ path:'test/screenshots/photo-mode.png' });
// capture button present?
const hasBar = await page.evaluate(()=>!!document.querySelector('.ams-photo-bar .ams-photo-cap'));
// HUD hidden?
const hudHidden = await page.evaluate(()=>document.getElementById('ui-root').classList.contains('ams-photo-hide'));
// close and confirm restore
await page.keyboard.press('KeyP');
await page.waitForTimeout(400);
const open2 = await page.evaluate(()=>window.__AMS__.game.photo.isOpen);
const hudRestored = await page.evaluate(()=>!document.getElementById('ui-root').classList.contains('ams-photo-hide'));
await browser.close(); server.close();
console.log(JSON.stringify({ open1, flew, hasBar, hudHidden, open2, hudRestored, errs: errs.slice(0,5) },null,2));
const ok = open1 && flew.hasCam && hasBar && hudHidden && !open2 && hudRestored && !errs.length;
console.log(ok ? 'PHOTO MODE CHECK PASSED' : 'PHOTO MODE CHECK FAILED');
process.exit(ok?0:1);
