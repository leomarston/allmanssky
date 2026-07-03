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
await page.waitForTimeout(2500);
// hop to a nearby system that actually hosts a station
const hop = await page.evaluate(async ()=>{
  const g = window.__AMS__.game;
  const cur = g.state.systemId;
  if (g.galaxy.getSystem(cur).station) return { id: cur };
  const neigh = g.galaxy.neighborsOf(cur, 12) || [];
  for (const n of neigh) {
    if (g.galaxy.getSystem(n.id).station) { await g.switchState('space', { systemId: n.id }); return { id: n.id }; }
  }
  return { id: null };
});
await page.waitForTimeout(2500);
// fly the ship to the station dock
const docked = await page.evaluate(()=>{
  const s = window.__AMS__.game.state;
  if (!s.station) return { hasStation:false };
  const dock = s.station.dockPos ? s.station.group.localToWorld(s.station.dockPos.clone()) : s.station.group.position.clone();
  s.shipCtl.position.copy(dock);
  s.shipCtl.velocity.set(0,0,0);
  s.shipCtl.throttle = 0;   // hold position so the dock prompt stays up
  return { hasStation:true };
});
await page.waitForTimeout(350);
const label = await page.evaluate(()=>window.__AMS__.game.state._interactLabel);
await page.keyboard.press('KeyF',{delay:90});
await page.waitForTimeout(1800);
const after = await page.evaluate(()=>({ name: window.__AMS__.game.state.name, faction: window.__AMS__.game.state.faction }));
await browser.close(); server.close();
const out = { hop, docked, label, after, errs: errs.slice(0,5) };
console.log(JSON.stringify(out,null,2));
const ok = docked.hasStation && /DISEMBARK/.test(label||'') && after.name==='hangar' && !errs.length;
console.log(ok ? 'DOCK CHECK PASSED' : 'DOCK CHECK FAILED');
process.exit(ok?0:1);
