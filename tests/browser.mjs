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
    const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/VFR_base\/v3\//,'');
    const path=resolve(root,relative||'index.html');
    if(!path.startsWith(root+'/')||!(await stat(path)).isFile())throw new Error('not found');
    res.writeHead(200,{'content-type':headers[extname(path)]??'application/octet-stream'});
    res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/VFR_base/v3/';
let instance;
try{
  instance=await chromium.launch({headless:true,executablePath:process.env.VFR_CHROMIUM,args:[
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
  async function overlay(){
    return page.locator('#foreground').evaluate(canvas=>{
      const {width,height}=canvas;
      const pixels=canvas.getContext('2d').getImageData(0,0,width,height).data;
      let count=0,x=0,minX=width,maxX=0,minY=height,maxY=0;
      for(let y=0;y<height;y+=3)for(let column=0;column<width;column+=3){
        if(pixels[(y*width+column)*4+3]<122)continue;
        count++;x+=column;
        minX=Math.min(minX,column);maxX=Math.max(maxX,column);
        minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      }
      return {count,center:count?x/count:0,x:minX,w:maxX-minX,y:minY,h:maxY-minY};
    });
  }
  await page.locator('button[data-frame=full]').click();
  await page.locator('button[data-filter=all]').click();
  await page.locator('.look[data-look=terra]').click();
  await page.locator('button[data-source=photo]').click();
  await page.locator('#photo-file').setInputFiles(photo);
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#stage').getAttribute('data-mask'),'ready');
  await page.locator('#stage[data-matte=active][data-fit=locked]').waitFor();
  assert.ok((await overlay()).count>160);
  console.log('OK: full-body pose and multiclass foreground mask');
  await page.locator('button[data-frame=upper]').click();
  await page.locator('.look[data-look=meridian]').click();
  await page.locator('#photo-file').setInputFiles(upper);
  await expectSignal('پرو روی عکس');
  await page.locator('#stage[data-matte=active]').waitFor();
  const initial=await overlay();
  assert.ok(initial.count>220 && initial.h>50,JSON.stringify(initial));
  if(process.env.VFR_BROWSER_SHOTS)await page.screenshot({path:'.render/pro-upper.jpg',type:'jpeg',quality:86});
  await page.locator('#adjust-fit').click();
  await page.locator('#coverage').selectOption('off');
  const beforeAdjustment=await overlay();
  await page.locator('#align-x').focus();
  await page.locator('#align-x').press('End');
  await page.locator('#alignment-dialog [data-close]').first().click();
  const adjusted=await overlay();
  assert.ok(adjusted.center>beforeAdjustment.center+8,JSON.stringify({beforeAdjustment,adjusted}));
  await page.locator('#adjust-fit').click();
  await page.locator('#align-reset').click();
  assert.equal(await page.locator('#align-x').inputValue(),'0');
  assert.equal(await page.locator('#coverage').inputValue(),'balanced');
  await page.locator('#alignment-dialog [data-close]').first().click();
  await page.locator('.look[data-look=orion]').click();
  assert.ok((await overlay()).count>220);
  if(process.env.VFR_BROWSER_SHOTS)await page.screenshot({path:'.render/pro-orion.jpg',type:'jpeg',quality:86});
  await page.locator('#inspect').click();
  await page.locator('#inspector').waitFor();
  const capturedReport=page.waitForEvent('download');
  await page.locator('#export-diagnostics').click();
  const report=await capturedReport;
  assert.equal(report.suggestedFilename(),'VFR-v3-diagnostics.json');
  const diag=JSON.parse(await readFile(await report.path(),'utf8'));
  assert.ok(diag.mask && diag.source==='photo' && diag.trackingScore>=50);
  assert.ok(!JSON.stringify(diag).includes('landmarks') && !('photo' in diag));
  await page.locator('#inspect').click();
  console.log('OK: cropped photo has fitted pixels, alignment and mask controls, sanitized diagnostics',initial,adjusted);
  await page.locator('button[data-frame=face]').click();
  await page.locator('#photo-file').setInputFiles(portrait);
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#stage').getAttribute('data-landmarks'),'478');
  console.log('OK: face-only image tracking',await page.locator('#stage').getAttribute('data-vision'));
  await page.locator('button[data-frame=full]').click();
  await page.locator('button[data-source=live]').click();
  await expectSignal('ردیابی بدن');
  await page.locator('#stage[data-matte=active]').waitFor();
  await page.locator('[data-open=settings-dialog]').click();
  await page.locator('#occlusion').uncheck();
  await page.locator('#settings-dialog [data-close]').click();
  await page.locator('#adjust-fit').click();
  await page.locator('#coverage').selectOption('off');
  await page.locator('#alignment-dialog [data-close]').first().click();
  const seen=[];
  const sampleDeadline=Date.now()+23_000;
  while(Date.now()<sampleDeadline){
    if(await page.locator('#stage').getAttribute('data-fit')==='locked'){
      const picture=await overlay();
      if(picture.count>160)seen.push(picture.center);
    }
    if(seen.length>1 && Math.max(...seen)-Math.min(...seen)>8)break;
    await new Promise(resolve=>setTimeout(resolve,135));
  }
  const drift=seen.length>1?Math.max(...seen)-Math.min(...seen):0;
  assert.ok(drift>8,JSON.stringify({drift,seen,errors}));
  console.log('OK: camera moves the rendered garment without silhouette clipping',Math.round(drift),'px');
  await page.locator('#freeze').click();
  await page.locator('#stage[data-source=photo]').waitFor();
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#video').evaluate(v=>!!v.srcObject),false);
  await page.locator('button[data-source=studio]').click();
  assert.equal(await page.locator('#video').evaluate(v=>!!v.srcObject),false);
  console.log('OK: garment follows a moving getUserMedia stream, freeze switches to photo and stops the camera');
  const mobile=await instance.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  await mobile.goto(url);
  await mobile.locator('.look').first().waitFor();
  assert.ok(await mobile.evaluate(()=>document.body.scrollWidth===innerWidth));
  assert.deepEqual(errors,[]);
  console.log('OK: mobile viewport');
}finally{await instance?.close();server.close();}
