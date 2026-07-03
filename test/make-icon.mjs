import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<canvas id="c" width="512" height="512"></canvas><style>body{margin:0}</style>
<script>
const g = document.getElementById('c').getContext('2d');
// deep space bg with vignette
const bg = g.createRadialGradient(256,256,60,256,256,360);
bg.addColorStop(0,'#0e2233'); bg.addColorStop(0.6,'#071018'); bg.addColorStop(1,'#02060a');
g.fillStyle=bg; g.beginPath(); g.arc(256,256,256,0,7); g.fill();
// stars
for(let i=0;i<90;i++){const x=Math.random()*512,y=Math.random()*512;
  const d=Math.hypot(x-256,y-256); if(d>250) continue;
  g.fillStyle='rgba(200,230,255,'+(0.25+Math.random()*0.6)+')';
  g.beginPath(); g.arc(x,y,Math.random()*1.6+0.4,0,7); g.fill();}
// ring behind
g.strokeStyle='rgba(125,232,255,0.85)'; g.lineWidth=17; g.lineCap='round';
g.beginPath(); g.ellipse(256,268,205,64,-0.42,Math.PI*0.93,Math.PI*1.97); g.stroke();
// planet
const pg = g.createRadialGradient(200,200,30,256,262,150);
pg.addColorStop(0,'#8fe0c0'); pg.addColorStop(0.45,'#2f8f78'); pg.addColorStop(0.8,'#173d55'); pg.addColorStop(1,'#0a1c2c');
g.fillStyle=pg; g.beginPath(); g.arc(256,262,148,0,7); g.fill();
// terminator shade
g.fillStyle='rgba(2,8,14,0.55)';
g.beginPath(); g.arc(256,262,148,0,7); g.clip?.call?.(g);
g.save(); g.beginPath(); g.arc(256,262,148,0,7); g.clip();
g.beginPath(); g.arc(340,330,180,0,7); g.fill(); g.restore();
// atmosphere rim
g.strokeStyle='rgba(125,232,255,0.9)'; g.lineWidth=6;
g.beginPath(); g.arc(256,262,152,0,7); g.stroke();
g.strokeStyle='rgba(125,232,255,0.25)'; g.lineWidth=16;
g.beginPath(); g.arc(256,262,158,0,7); g.stroke();
// ring front
g.strokeStyle='#aef0ff'; g.lineWidth=17;
g.beginPath(); g.ellipse(256,268,205,64,-0.42,-Math.PI*0.07,Math.PI*0.93); g.stroke();
// star glint
const sg=g.createRadialGradient(118,120,2,118,120,52);
sg.addColorStop(0,'rgba(255,250,230,1)'); sg.addColorStop(0.25,'rgba(255,220,150,0.75)'); sg.addColorStop(1,'rgba(255,200,120,0)');
g.fillStyle=sg; g.fillRect(50,52,140,140);
g.fillStyle='#fff';
g.beginPath(); g.moveTo(118,96); g.lineTo(126,114); g.lineTo(144,120); g.lineTo(126,127); g.lineTo(118,146); g.lineTo(110,127); g.lineTo(92,120); g.lineTo(110,114); g.closePath(); g.fill();
</script>`);
await page.waitForTimeout(600);
const el = await page.$('#c');
await el.screenshot({ path: 'steam/build/icon.png', omitBackground: true });
await browser.close();
console.log('icon written');
