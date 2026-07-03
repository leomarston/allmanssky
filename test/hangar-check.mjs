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
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=hangar`);
await page.waitForFunction(()=>window.__AMS__?.ready,{timeout:40000});
await page.waitForTimeout(3500);

// structural facts
const facts = await page.evaluate(()=>{
  const s = window.__AMS__.game.state;
  return {
    name: s.name,
    terminals: s.hangar.interactables.map(i=>i.kind),
    npcs: s.crowd.npcs.length,
    hasShip: !!s.shipObj?.group,
  };
});
await page.screenshot({ path:'test/screenshots/hangar.png' });

// walk to the TRADE terminal and open it with F (held so a frame samples it)
await page.evaluate(()=>{
  const s = window.__AMS__.game.state;
  const it = s.hangar.interactables.find(i=>i.kind==='trade');
  s.player.position.set(it.position.x+1.4, 0, it.position.z);
  s.player.yaw = -Math.PI/2;
});
await page.waitForTimeout(250);
await page.keyboard.press('KeyF',{delay:90});
await page.waitForTimeout(300);
const trade = await page.evaluate(()=>({ open: window.__AMS__.game.ui.trade.isOpen, label: window.__AMS__.game.state._interactLabel }));
await page.keyboard.press('Escape',{delay:90});
await page.waitForTimeout(300);
const tradeClosed = await page.evaluate(()=>!window.__AMS__.game.ui.trade.isOpen);

// speak with a crew member: park one on open deck away from terminals/pad
await page.evaluate(()=>{
  const s = window.__AMS__.game.state;
  const t = s.crowd.talkables[0];
  t.position.set(-3, 0, -18);           // live ref to the NPC's group position
  s.player.position.set(-4.5, 0, -18);  // ~1.5 m away → NPC is the nearest actionable
});
await page.waitForTimeout(350);         // let the NPC notice, stop, and face
await page.keyboard.press('KeyF',{delay:90});
await page.waitForTimeout(300);
const spoke = await page.evaluate(()=>window.__AMS__.game.state._speech.style.display!=='none');

// board the ship → should leave to space
await page.evaluate(()=>{
  const s = window.__AMS__.game.state;
  s.player.position.set(s.shipObj.group.position.x, 0, s.shipObj.group.position.z);
});
await page.waitForTimeout(200);
await page.keyboard.press('KeyF',{delay:90});
await page.waitForTimeout(1800);
const left = await page.evaluate(()=>window.__AMS__.game.state.name);

await browser.close(); server.close();
const out = { facts, trade, tradeClosed, spoke, left, errs: errs.slice(0,6) };
console.log(JSON.stringify(out,null,2));
const ok = facts.name==='hangar'
  && facts.terminals.length===3 && facts.npcs>0 && facts.hasShip
  && trade.open && tradeClosed && spoke && left==='space' && !errs.length;
console.log(ok ? 'HANGAR CHECK PASSED' : 'HANGAR CHECK FAILED');
process.exit(ok?0:1);
