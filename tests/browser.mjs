import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import { resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import jpeg from 'jpeg-js';

const [photo, portrait, video, rear] = process.argv.slice(2).map(resolvePath);
function resolvePath(x){return resolve(x);}
if(!photo||!portrait||!video||!rear)throw new Error('Pass a full pose photo, a portrait, a Y4M video and a rear photo.');
async function crop(file,name,u,v,w,h){
  const dest=resolve('.render/'+name+'.jpg');
  const pixels=jpeg.decode(await readFile(file),{useTArray:true});
  const x0=Math.floor(pixels.width*u), y0=Math.floor(pixels.height*v);
  const width=Math.floor(pixels.width*w), height=Math.floor(pixels.height*h);
  const rgb=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++){
    const from=((y+y0)*pixels.width+x0)*4;
    rgb.set(pixels.data.subarray(from,from+width*4),y*width*4);
  }
  await writeFile(dest,jpeg.encode({data:rgb,width,height},89).data);
  return dest;
}
const upper=await crop(photo,'upper-fixture',.27,.32,.47,.292);
const close=await crop(portrait,'close-fixture',.095,.010,.81,.455);
const closeVideo=resolve('.render/close-camera.y4m');
execFileSync(process.execPath,['tests/y4m-fixture.mjs',close,closeVideo,'--alignment-mark']);
const root=resolve('dist');
const headers={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json',
  '.wasm':'application/wasm','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  try{
    const relative=new URL(req.url,'http://localhost').pathname.replace(/^\/VFR_base\/v7\//,'');
    const path=resolve(root,relative||'index.html');
    if(!path.startsWith(root+'/')||!(await stat(path)).isFile())throw new Error('not found');
    res.writeHead(200,{'content-type':headers[extname(path)]??'application/octet-stream'});
    res.end(await readFile(path));
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port+'/VFR_base/v7/';
let instance;
try{
  const launch=(input)=>chromium.launch({headless:true,executablePath:process.env.VFR_CHROMIUM,args:[
    '--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+input,
  ]});
  const errors=[];
  async function desktop(browser){
    const context=await browser.newContext({viewport:{width:1200,height:800},acceptDownloads:true,permissions:['camera'],reducedMotion:'reduce'});
    const tab=await context.newPage();
    tab.setDefaultTimeout(45000);
    tab.on('pageerror',e=>errors.push(e.message));
    tab.on('console',line=>{if(line.type()==='error')console.log('browser console:',line.text().slice(0,350));});
    return tab;
  }
  instance=await launch(video);
  let page=await desktop(instance);
  await page.goto(url);
  await page.locator('#stage[data-renderer=webgl]').waitFor();
  assert.equal(await page.locator('.look').count(),8);
  await page.locator('#stage[data-garment-mesh]').waitFor();
  const mannequinTriangles=Number(await page.locator('#stage').getAttribute('data-garment-mesh'));
  assert.ok(mannequinTriangles>20_000, String(mannequinTriangles));
  const canvas=page.locator('#render');
  const mannequinFront=jpeg.decode(await canvas.screenshot({type:'jpeg',quality:79}));
  await page.locator('[data-angle="90"]').click();
  await page.locator('#stage[data-angle="90"]').waitFor();
  const mannequinSide=jpeg.decode(await canvas.screenshot({type:'jpeg',quality:79}));
  await page.locator('[data-angle="180"]').click();
  await page.locator('#stage[data-angle="180"]').waitFor();
  const mannequinRear=jpeg.decode(await canvas.screenshot({type:'jpeg',quality:79}));
  for(const other of [mannequinSide,mannequinRear]){
    let count=0;
    for(let i=0;i<mannequinFront.data.length;i+=32){
      if(Math.abs(other.data[i]-mannequinFront.data[i])+Math.abs(other.data[i+1]-mannequinFront.data[i+1])>31)count++;
    }
    assert.ok(count>590, String(count));
  }
  if(process.env.VFR_BROWSER_SHOTS)await page.screenshot({path:'.render/pro-mannequin-rear.jpg',type:'jpeg',quality:90});
  await page.locator('#play-turn').click();
  await page.locator('#stage[data-angle="180"]').waitFor({timeout:30_000});
  assert.equal(await page.locator('#play-turn').getAttribute('aria-pressed'),'false');
  await page.locator('[data-angle="0"]').click();
  console.log('OK: mannequin front, profile, and rear pixels, automatic half-turn, and refined garment',mannequinTriangles);
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
      return {count,center:count?x/count:0,x:minX,w:maxX-minX,y:minY,h:maxY-minY,width,height};
    });
  }
  const shots=Boolean(process.env.VFR_BROWSER_SHOTS);
  const preview=(name)=>shots?page.screenshot({path:'.render/pro-'+name+'.jpg',type:'jpeg',quality:89}):null;
  async function expectOverlay(valid){
    const deadline=Date.now()+19_000;
    let measured;
    do{
      measured=await overlay();
      if(valid(measured))return measured;
      await new Promise(resolve=>setTimeout(resolve,160));
    }while(Date.now()<deadline);
    throw new Error('Incorrect overlay: '+JSON.stringify(measured));
  }
  async function openDiagnostics(){
    await page.locator('#inspect').click();
    await page.locator('#inspector').waitFor();
    const capturedReport=page.waitForEvent('download');
    await page.locator('#export-diagnostics').click();
    const report=await capturedReport;
    assert.equal(report.suggestedFilename(),'VFR-v7-diagnostics.json');
    const diag=JSON.parse(await readFile(await report.path(),'utf8'));
    assert.ok(!JSON.stringify(diag).includes('landmarks') && !('photo' in diag));
    await page.locator('#inspect').click();
    return diag;
  }
  await page.locator('button[data-frame=full]').click();
  await page.locator('button[data-filter=all]').click();
  await page.locator('.look[data-look=terra]').click();
  await page.locator('button[data-source=photo]').click();
  await page.locator('#photo-file').setInputFiles(photo);
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#stage').getAttribute('data-mask'),'ready');
  await page.locator('#stage[data-matte=active][data-fit=locked][data-cloth=drape]').waitFor();
  assert.ok((await overlay()).count>160);
  const fullCount=Number(await page.locator('#stage').getAttribute('data-body-mesh'));
  assert.ok(fullCount>2500, String(fullCount));
  console.log('OK: full-body pose, articulated skin and multiclass foreground mask',fullCount);
  await page.locator('button[data-frame=upper]').click();
  await page.locator('.look[data-look=meridian]').click();
  await page.locator('#photo-file').setInputFiles(upper);
  await expectSignal('پرو روی عکس');
  await page.locator('#stage[data-matte=active]').waitFor();
  const initial=await overlay();
  assert.ok(initial.count>220 && initial.h>50,JSON.stringify(initial));
  await preview('upper');
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
  await preview('orion');
  const diag=await openDiagnostics();
  assert.ok(diag.mask && diag.source==='photo' && diag.trackingScore>=50);
  assert.equal(diag.clothModel,'drape');
  assert.ok(diag.bodyTriangles>2000 && diag.clothVertices>1500 && diag.contactCorrections>0);
  assert.ok(diag.displayTriangles>4*diag.simulationTriangles);
  assert.ok(diag.testedFaces>4700 && diag.residualFaces<diag.testedFaces*.15,JSON.stringify(diag));
  console.log('OK: cropped photo has fitted pixels, alignment and mask controls, sanitized diagnostics',initial,adjusted);
  await page.locator('#photo-file').setInputFiles(close);
  const closeWidth=jpeg.decode(await readFile(close)).width;
  await page.waitForFunction(w=>document.querySelector('#photo').naturalWidth===w,closeWidth);
  await expectSignal('پرو روی عکس');
  await page.locator('#stage[data-depth=body][data-matte=active]').waitFor();
  const tight=await overlay();
  assert.ok(tight.count>170 && tight.y>tight.height*.29 && tight.h>42,JSON.stringify(tight));
  assert.equal(await page.locator('#message').isVisible(),false);
  await preview('near');
  await page.locator('#view-volume').click();
  await page.locator('#stage[data-view=model]').waitFor();
  const render=page.locator('#render');
  const front=jpeg.decode(await render.screenshot({type:'jpeg',quality:82}));
  await page.locator('#orbit-angle').evaluate(input=>{
    input.value='77';
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  const side=jpeg.decode(await render.screenshot({type:'jpeg',quality:82}));
  let changed=0;
  for(let i=0;i<front.data.length;i+=24){
    if(Math.abs(front.data[i]-side.data[i])+Math.abs(front.data[i+1]-side.data[i+1])+Math.abs(front.data[i+2]-side.data[i+2])>36)changed++;
  }
  assert.ok(changed>420,JSON.stringify({changed}));
  await preview('orbit');
  await page.locator('#orbit-mode').selectOption('body');
  await page.locator('#orbit-angle').press('End');
  await preview('skin');
  const exported=page.waitForEvent('download');
  await page.locator('#export-body').click();
  const mesh=await exported;
  assert.equal(mesh.suggestedFilename(),'VFR-v7-body.obj');
  const obj=await readFile(await mesh.path(),'utf8');
  assert.ok((obj.match(/^v /gm)??[]).length>990 && (obj.match(/^f /gm)??[]).length>2000);
  await page.locator('#orbit-mode').selectOption('strain');
  await page.locator('#strain-key').waitFor();
  await page.locator('#orbit-angle').evaluate(input=>{
    input.value='24';
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await preview('strain');
  await page.locator('#orbit-mode').selectOption('contact');
  await page.locator('#contact-key').waitFor();
  await page.locator('[data-angle="180"]').click();
  await page.locator('#stage[data-angle="180"]').waitFor();
  await preview('contact');
  await page.locator('#view-volume').click();
  await page.locator('#stage[data-view=image]').waitFor();
  console.log('OK: cropped torso, changing 3D viewpoints, body OBJ and cloth strain inspection',changed);
  await page.locator('#photo-file').setInputFiles(rear);
  await expectSignal('پرو روی عکس');
  await page.locator('#stage[data-direction=back][data-depth=body][data-garment-mesh]').waitFor({timeout:30000});
  await expectOverlay(p=>p.count>190&&p.w>90);
  const backReport=await openDiagnostics();
  assert.equal(backReport.direction,'back');
  assert.ok(Math.abs(backReport.yaw)>143,JSON.stringify(backReport));
  await preview('rear-photo');
  await page.locator('#view-volume').click();
  await page.locator('#stage[data-view=model][data-angle="0"]').waitFor();
  const wornFront=jpeg.decode(await render.screenshot({type:'jpeg',quality:77}));
  await page.locator('[data-angle="180"]').click();
  await page.locator('#stage[data-angle="180"]').waitFor();
  const wornBack=jpeg.decode(await render.screenshot({type:'jpeg',quality:77}));
  let turnDiff=0;
  for(let i=0;i<wornFront.data.length;i+=28)if(Math.abs(wornFront.data[i]-wornBack.data[i])+Math.abs(wornFront.data[i+1]-wornBack.data[i+1])>37)turnDiff++;
  assert.ok(turnDiff>400,String(turnDiff));
  await preview('person-rear');
  await page.locator('#view-volume').click();
  console.log('OK: rear-facing photograph, back of garment, and wearer-relative 180 degree orbit',backReport.yaw);
  await page.locator('button[data-frame=face]').click();
  await page.locator('#photo-file').setInputFiles(portrait);
  await expectSignal('پرو روی عکس');
  assert.equal(await page.locator('#stage').getAttribute('data-landmarks'),'478');
  await page.locator('#stage[data-depth=face]').waitFor();
  const eyewear=await overlay();
  assert.ok(eyewear.count>28 && eyewear.w>42 && eyewear.y<eyewear.height*.35,JSON.stringify(eyewear));
  const glassesReport=await openDiagnostics();
  assert.ok(glassesReport.headFitPx>=0&&glassesReport.headFitPx<23,JSON.stringify(glassesReport));
  await preview('glasses');
  console.log('OK: face surface fit and actual visible frame pixels',eyewear,glassesReport.headFitPx);
  await page.locator('button[data-frame=full]').click();
  await page.locator('button[data-source=live]').click();
  await expectSignal('ردیابی بدن');
  await page.locator('#stage[data-matte=active]').waitFor();
  await page.locator('#turn-person').click();
  await page.locator('#guidance').waitFor();
  await page.locator('#turn-person').click();
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
  console.log('OK: mobile viewport');

  await instance.close();
  instance=await launch(closeVideo);
  page=await desktop(instance);
  await page.goto(url);
  await page.locator('#stage[data-renderer=webgl]').waitFor();
  await page.locator('button[data-frame=upper]').click();
  await page.locator('.look[data-look=orion]').click();
  assert.equal(await page.locator('#stage').getAttribute('data-frame'),'upper');
  await page.locator('button[data-source=live]').click();
  try{
    await page.locator('#stage[data-depth=body][data-matte=active]').waitFor({timeout:85000});
  }catch(error){
    const state=await page.locator('#stage').evaluate(stage=>{
      const video=stage.querySelector('video');
      return {fit:{...stage.dataset},label:stage.querySelector('#state-label').textContent,
        message:stage.querySelector('#message-body').textContent,video:[video.videoWidth,video.videoHeight,video.currentTime]};
    });
    await preview('near-blocked');
    throw new Error('Close live body: '+JSON.stringify(state)+' '+errors.join(' / '),{cause:error});
  }
  const nearLive=await expectOverlay(p=>p.count>130&&p.y>p.height*.41);
  await preview('near-live');
  await page.locator('button[data-frame=face]').click();
  await expectSignal('ردیابی چهره');
  await page.locator('#stage[data-depth=face][data-sync=matched]').waitFor();
  const lensLive=await expectOverlay(p=>p.count>48&&p.w>60&&p.y<p.height*.52);
  const alignment=[];
  const deadline=Date.now()+26000;
  while(Date.now()<deadline){
    const point=await page.locator('#stage').evaluate(stage=>{
      if(stage.dataset.sync!=='matched'||stage.dataset.depth!=='face')return null;
      const rgb=stage.querySelector('#camera-frame'), fg=stage.querySelector('#foreground');
      const {width,height}=rgb;
      const mask=rgb.getContext('2d').getImageData(0,14,width,1).data;
      let n=0,sum=0;
      for(let x=0;x<width;x++)if(mask[x*4+1]>165&&mask[x*4]<105&&mask[x*4+2]<110){n++;sum+=x;}
      if(n<5)return null;
      const ratio=Math.min(fg.width/width,fg.height/height);
      const drawing=fg.getContext('2d').getImageData(0,0,fg.width,fg.height).data;
      let left=fg.width,right=0;
      for(let y=0;y<fg.height*.54;y+=2)for(let x=0;x<fg.width;x+=2){
        if(drawing[(y*fg.width+x)*4+3]<125)continue;
        left=Math.min(left,x);right=Math.max(right,x);
      }
      if(right-left<55)return null;
      // The marker follows the fixture's translation. The bridge in the source portrait is at x = .491 of its crop.
      const expected=(fg.width-width*ratio)*.5+(width-(sum/n+width*(.491-.23)))*ratio;
      return {expected,error:Math.abs(expected-(left+right)*.5)};
    });
    if(point&&alignment.every(x=>Math.abs(x.expected-point.expected)>7))alignment.push(point);
    if(alignment.length>=3&&Math.max(...alignment.map(x=>x.expected))-Math.min(...alignment.map(x=>x.expected))>25)break;
    await new Promise(resolve=>setTimeout(resolve,140));
  }
  assert.ok(alignment.length>=3&&Math.max(...alignment.map(x=>x.error))<24,JSON.stringify(alignment));
  console.log('OK: moving optical frame stays aligned with the same camera pixels',alignment);
  await preview('glasses-live');
  await page.locator('button[data-source=studio]').click();
  assert.equal(await page.locator('#video').evaluate(v=>!!v.srcObject),false);
  assert.deepEqual(errors,[]);
  console.log('OK: near webcam body and mirrored optics on the same moving stream',nearLive,lensLive);
}finally{await instance?.close();server.close();}
