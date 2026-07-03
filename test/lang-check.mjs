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
// touch a stone: force-teach via the state's Language + a fake stone
const learn = await page.evaluate(()=>{
  const s=window.__AMS__.game.state;
  const before=s.language.count();
  s._touchStone({ taught:false, position:s.player.position.clone() });
  return { before, after:s.language.count() };
});
// commune a ruin: gloss produces spans
const gloss = await page.evaluate(()=>{
  const s=window.__AMS__.game.state;
  s._commune({ lore:{title:'Test Fragment', text:'The wayfarer folded into light and left only silence and memory of the ocean.'}, position:s.player.position.clone() });
  const modal=[...document.querySelectorAll('#ui-root div')].find(d=>d.textContent.includes('Test Fragment'));
  return { hasModal:!!modal, hasSpans: modal?document.querySelector('.lum-unknown')!==null:false };
});
await page.screenshot({path:'test/screenshots/lang-lore.png'});
await browser.close();server.close();
console.log(JSON.stringify({learn,gloss,errs:errs.slice(0,4)}));
const ok=learn.after===learn.before+1 && gloss.hasModal && gloss.hasSpans && !errs.length;
console.log(ok?'LANGUAGE CHECK PASSED':'LANGUAGE CHECK FAILED');
