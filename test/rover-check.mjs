import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
const root='/home/user/allmanssky';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{try{const p=decodeURIComponent(new URL(req.url,'http://x').pathname);const d=await readFile(join(root,p==='/'?'/index.html':p));res.writeHead(200,{'Content-Type':MIME[extname(p)]||'application/octet-stream'});res.end(d);}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,r));
const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium',args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader','--no-sandbox']});
const page=await browser.newPage({viewport:{width:1280,height:720}});
const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/favicon/.test(m.text()))errs.push(m.text());});
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=surface&biome=lush&tod=0.15`);
await page.waitForFunction(()=>window.__AMS__?.ready,{timeout:40000});
await page.waitForTimeout(4000);
// unlock + summon + board via game API (deterministic), then drive with W
const r1 = await page.evaluate(()=>{
  const s=window.__AMS__.game.state; const gs=window.__AMS__.game.gameState;
  gs.exocraft.unlocked=true;
  const ok=s.rover.summon(s.player.position.clone(), s.player.yaw);
  return { deployed:s.rover.deployed, ok, y:+s.rover.position.y.toFixed(1), ground:+s.field.height(s.rover.position.x,s.rover.position.z).toFixed(1) };
});
await page.evaluate(()=>{ const s=window.__AMS__.game.state; s.player.teleport(s.rover.position.x+3, s.rover.position.z); s.rover.enter(s.player); });
await page.waitForTimeout(300);
const active = await page.evaluate(()=>window.__AMS__.game.state.rover.active);
const p0 = await page.evaluate(()=>window.__AMS__.game.state.rover.position.clone());
await page.keyboard.down('KeyW');
await page.waitForTimeout(2500);
await page.screenshot({path:'test/screenshots/rover-drive.png'});
await page.keyboard.up('KeyW');
const r2 = await page.evaluate(()=>{
  const s=window.__AMS__.game.state;
  const p=s.rover.position;
  return { speed:+s.rover.speed.toFixed(1), moved:+Math.hypot(p.x,p.z).toFixed(1),
           aboveGround:+(p.y - s.field.height(p.x,p.z)).toFixed(2) };
});
await browser.close();server.close();
console.log(JSON.stringify({r1,active,r2,errs:errs.slice(0,4)}));
const ok = r1.deployed && r1.ok && active && r2.speed>2 && r2.aboveGround>0 && r2.aboveGround<3 && !errs.length;
console.log(ok?'ROVER CHECK PASSED':'ROVER CHECK FAILED');
