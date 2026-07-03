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
// give lumens + a couple items, open trade UI on current system
await page.evaluate(()=>{const g=window.__AMS__.game;g.gameState.addLumens(5000);g.gameState.addItem('solanite',10);g.ui.trade.open(g.state.system);});
await page.waitForTimeout(500);
// click ROUTES tab
await page.evaluate(()=>{[...document.querySelectorAll('.tr-tab')].find(b=>b.dataset.tab==='routes')?.click();});
await page.waitForTimeout(500);
await page.screenshot({path:'test/screenshots/econ-routes.png'});
const routesShown=await page.evaluate(()=>document.querySelector('#tr-body')?.textContent?.includes('sell at'));
const tagsShown=await page.evaluate(()=>{[...document.querySelectorAll('.tr-tab')].find(b=>b.dataset.tab==='commodities')?.click();return true;});
await page.waitForTimeout(300);
await page.screenshot({path:'test/screenshots/econ-commodities.png'});
const hasTag=await page.evaluate(()=>document.querySelector('#tr-body')?.innerHTML?.includes('EXPORT')||document.querySelector('#tr-body')?.innerHTML?.includes('IMPORT'));
await browser.close();server.close();
console.log(JSON.stringify({routesShown,hasTag,errs:errs.slice(0,4)}));
console.log((routesShown&&hasTag&&!errs.length)?'ECONOMY UI CHECK PASSED':'ECONOMY UI CHECK FAILED');
