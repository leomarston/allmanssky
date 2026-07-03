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
await page.goto(`http://127.0.0.1:${server.address().port}/index.html?state=space`);
await page.waitForFunction(()=>window.__AMS__?.ready,{timeout:40000});
await page.waitForTimeout(3500);
// open board, accept first available mission, then click ACTIVE tab
await page.evaluate(()=>window.__AMS__.game.ui.missions.open(window.__AMS__.game.state.system));
await page.waitForTimeout(400);
await page.screenshot({path:'test/screenshots/mission-board.png'});
const accept = await page.evaluate(()=>{
  const g=window.__AMS__.game;
  const offers=g.ui.missions._offers;
  const before=(g.gameState.quests.board||[]).length;
  g.quests.acceptBoard(offers[0]);
  return { before, after:g.gameState.quests.board.length, title:offers[0].title };
});
// force-complete a courier: inject a courier mission + items, claim it
const courier = await page.evaluate(()=>{
  const g=window.__AMS__.game;
  const repBefore=g.gameState.quests.reputation.meridian;
  const m={ id:'test:courier', faction:'meridian', kind:'courier', filterId:'oxylite', need:3, event:'courier', reward:{lumens:200, rep:20}, title:'Test Courier' };
  g.gameState.quests.board.push(m);
  g.gameState.addItem('oxylite', 5);
  const ok=g.quests.claimCourier(m);
  return { ok, repBefore, repAfter:g.gameState.quests.reputation.meridian, held:g.gameState.countItem('oxylite') };
});
await browser.close();server.close();
console.log(JSON.stringify({accept,courier,errs:errs.slice(0,4)}));
const pass = accept.after===accept.before+1 && courier.ok && courier.repAfter===courier.repBefore+20 && courier.held===2 && !errs.length;
console.log(pass?'MISSION CHECK PASSED':'MISSION CHECK FAILED');
