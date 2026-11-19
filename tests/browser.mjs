import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { resolve, extname } from 'node:path';
import { chromium } from 'playwright';
import jpeg from 'jpeg-js';

const [photo, portrait, video] = process.argv.slice(2).map(resolvePath);
function resolvePath(x){return resolve(x);}
if(!photo||!portrait||!video)throw new Error('Pass a full pose photo, a portrait, and a Y4M video.');
const upper=resolve('.render/upper-fixture.jpg');
const pixels=jpeg.decode(await readFile(photo),{useTArray:true});
const x0=Math.floor(pixels.width*.27), y0=Math.floor(pixels.height*.32);
const width=Math.floor(pixels.width*.47), height=Math.floor(pixels.height*.292);
const rgb=new Uint8Array(width*height*4);
for(let y=0;y<height;y++){
  const from=((y+y0)*pixels.width+x0)*4;
  rgb.set(pixels.data.subarray(from,from+width*4),y*width*4);
}
await writeFile(upper,jpeg.encode({data:rgb,width,height},87).data);
const root=resolve('dist');
const headers={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.wasm':'application/wasm','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/VFR_base\/v2\//,'');
    const path=resolve(root,relative||'index.html');
    if(!path.startsWith(root+'/')||!(await stat(path)).isFile())throw new Error('not found');
    res.writeHead(200,{'content-type':headers[extname(path)]??'application/octet-stream'});
    res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/VFR_base/v2/';
let instance;
try{
  instance=await chromium.launch({headless:true,args:[
    '--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+video,
  ]});
  const context=await instance.newContext({viewport:{width:1200,height:800},acceptDownloads:true,permissions:['camera'],reducedMotion:'reduce'});
  const page=await context.newPage();
  page.setDefaultTimeout(45000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',line=>{if(line.type()==='error')console.log('browser console:',line.text().slice(0,350));});
  await page.goto(url);
  await page.locator('#stage[data-renderer=webgl]').waitFor();
  assert.equal(await page.locator('.look').count(),8);
  await page.locator('#wind').click();
  await page.locator('#compare').click();
  await page.locator('#split-slider').press('ArrowRight');
  const capture=page.waitForEvent('download');
  await page.locator('#capture').click();
  assert.match((await capture).suggestedFilename(),/^VFR-TRA-.+\.png$/);
  console.log('OK: garment rendering, wind, comparison and PNG export');
  await page.locator('#wind').click();
  await page.locator('#compare').click();
  await page.locator('button[data-frame=upper]').click();
  assert.equal(await page.locator('#stage').getAttribute('data-frame'),'upper');
  await page.locator('button[data-frame=face]').click();
  assert.match(await page.locator('#item-title').textContent(),/فریم/);
  await page.locator('button[data-open=import-dialog]').click();
  await page.locator('#sample-zip').click();
  await page.locator('.look[data-look=scan-meridian-package]').waitFor();
  assert.deepEqual(await page.locator('#size-select option').allTextContents(),['46 Tall','52 Regular']);
  await page.locator('#size-select').selectOption({label:'46 Tall'});
  await page.locator('button[data-open=size-dialog]').click();
  assert.match(await page.locator('#chart tr.active').textContent(),/46 Tall/);
  await page.locator('#size-dialog [data-close]').click();
  await page.locator('#add-cart').click();
  assert.match(await page.locator('#cart-lines').textContent(),/46 Tall/);
  const order=page.waitForEvent('download');
  await page.locator('#export-cart').click();
  assert.equal((await order).suggestedFilename(),'VFR-order-draft.json');
  await page.locator('#cart-dialog [data-close]').first().click();
  await page.locator('button[data-open=fit-dialog]').first().click();
  const body=page.waitForEvent('filechooser');
  await page.locator('#import-body').click();
  await (await body).setFiles('docs/body-measurements.json');
  await page.getByText('اندازه‌های فایل اسکن واردشده',{exact:true}).waitFor();
  await page.locator('#fit-dialog [data-close]').click();
  console.log('OK: GLB package, non-letter sizes, body scan and cart checkout draft');

  async function expectSignal(label,timeout=115000){
    try{
      await page.waitForFunction(x=>document.querySelector('#state-label').textContent===x,label,{timeout});
    }catch(e){
      const status=await page.locator('#state-label').innerText();
      const message=await page.locator('#message-body').textContent();
      console.log('landmark count:',await page.locator('#stage').getAttribute('data-landmarks'));
      throw new Error(`Expected ${label}; saw ${status}: ${message}; errors: ${errors.join(' / ')}`,{cause:e});
    }
  }
  await page.locator('button[data-frame=full]').click();
  await page.locator('button[data-source=photo]').click();
  await page.locator('#photo-file').setInputFiles(photo);
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#stage').getAttribute('data-mask'),'ready');
  console.log('OK: full-body pose and multiclass foreground mask');
  await page.locator('button[data-frame=upper]').click();
  await page.locator('#photo-file').setInputFiles(upper);
  await expectSignal('پرو روی عکس');
  console.log('OK: cropped upper-body photo');
  await page.locator('button[data-frame=face]').click();
  await page.locator('#photo-file').setInputFiles(portrait);
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#stage').getAttribute('data-landmarks'),'478');
  console.log('OK: face-only image tracking',await page.locator('#stage').getAttribute('data-vision'));
  await page.locator('button[data-frame=full]').click();
  await page.locator('button[data-source=live]').click();
  await expectSignal('ردیابی بدن');
  await page.locator('button[data-source=studio]').click();
  assert.equal(await page.locator('#video').evaluate(v=>!!v.srcObject),false);
  console.log('OK: actual MediaPipe inference on getUserMedia test stream, track ends on exit');
  const mobile=await instance.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await mobile.goto(url);
  await mobile.locator('.look').first().waitFor();
  assert.ok(await mobile.evaluate(()=>document.body.scrollWidth===innerWidth));
  assert.deepEqual(errors,[]);
  console.log('OK: mobile viewport');
}finally{await instance?.close();server.close();}
