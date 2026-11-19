import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { resolve, extname } from 'node:path';
const [photoFixture, videoFixture] = process.argv.slice(2).map((path) => resolve(path));
if (!photoFixture || !videoFixture) throw new Error('Pass the photo and Y4M webcam fixture paths');
const root = resolve('dist');
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.webp':'image/webp', '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const relative = new URL(req.url, 'http://localhost').pathname.replace(/^\/VFR_base\//, '');
    const path = resolve(root, relative || 'index.html');
    if (!path.startsWith(root + '/') || !(await stat(path)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch { res.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port + '/VFR_base/';
let browser;
try {
 browser = await chromium.launch({ headless: true, args: [
  '--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
  '--use-file-for-fake-video-capture=' + videoFixture,
] });
 const errors = [];
 const context = await browser.newContext({ viewport: { width: 1240, height: 800 }, permissions: ['camera'], acceptDownloads: true, reducedMotion: 'reduce' });
 const page = await context.newPage();
 page.on('pageerror', (e) => errors.push(e.message));
 page.on('console',(msg)=>{if(msg.type()==='error'||msg.text().includes('Camera fitting')||msg.text().includes('Image fitting')) console.log('console',msg.text().slice(0,330));});
 page.on('response',(r)=>{if(r.status()>=400)console.log('HTTP',r.status(),r.url());});
 await page.goto(url);
 await page.locator('#stage[data-renderer=webgl]').waitFor({timeout:20000});
 await page.waitForFunction(() => document.querySelector('#garment-list img').naturalWidth > 0);
 assert.equal(await page.locator('.look-card').count(),8);
 console.log('OK: WebGL renderer and eight local images under /VFR_base/');
 await page.locator('#wind').click();
 assert.equal(await page.locator('#wind').getAttribute('aria-pressed'),'true');
 await page.locator('#compare').click();
 assert.equal(await page.locator('#compare-range').isVisible(),true);
 await page.locator('#compare-range').press('ArrowRight');
 const capture = page.waitForEvent('download');
 await page.locator('#capture').click();
 assert.match((await capture).suggestedFilename(),/^VFR-luna-M.png$/);
 console.log('OK: wind, before/after and PNG');
 await page.locator('[data-filter="men"]').click();
 assert.equal(await page.locator('.look-card').count(),4);
 await page.locator('.look-card[data-look="ash"]').click();
 await page.locator('#sizes button').filter({ hasText: /^XL$/ }).click();
 await page.locator('#swatches button[aria-label="آبی دودی"]').click();
 assert.equal(await page.locator('#look-name').textContent(),'بامبر اِش');
 await page.locator('#fit-link').click();
 for (const [k,v] of Object.entries({height:174,chest:100,waist:88,hips:96})) await page.locator('#fit-form [name='+k+']').fill(String(v));
 await page.locator('#fit-form [type=submit]').click();
 assert.match(await page.locator('#fit-state').textContent(),/پیشنهاد سایز/);
 await page.locator('.pattern-link').click();
 assert.ok(await page.locator('#pattern-dialog').isVisible(), 'template editor opens');
 const patternChooser = page.waitForEvent('filechooser');
 await page.locator('#import-pattern').click();
 await (await patternChooser).setFiles(resolve('docs/garment-template.json'));
 await page.waitForFunction(()=>document.querySelector('#pattern-form [name=name]').value==='پیراهن سفارشی');
 await page.locator('#pattern-form [type=submit]').click();
 assert.equal(await page.locator('#look-name').textContent(),'پیراهن سفارشی');
 console.log('OK: category, size, color, measurements and JSON import');
 await page.locator('button[data-mode="photo"]').click();
 await page.locator('#photo-input').setInputFiles(photoFixture);
 await page.waitForFunction(() => document.querySelector('#signal').textContent==='پرو روی عکس',{},{timeout:90000});
 console.log('OK: Photo uses the real MediaPipe model');
 await page.locator('button[data-mode="live"]').click();
 await page.waitForFunction(() => document.querySelector('#signal').textContent==='ردیابی فعال',{},{timeout:90000});
 console.log('OK: Webcam fixture uses getUserMedia and live model', await page.locator('#stage-meter').textContent());
 await page.locator('#source-action').click();
 assert.equal(await page.locator('#video').evaluate((v) => !!v.srcObject), false);
 assert.equal(await page.locator('#stage').getAttribute('data-mode'),'studio');
 const mobile = await browser.newPage({viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2});
 await mobile.goto(url);
 await mobile.locator('.look-card').first().waitFor();
 assert.equal(await mobile.evaluate(()=>document.body.scrollWidth === innerWidth), true);
 console.log('OK: camera track closes and mobile viewport has no horizontal overflow');
 assert.deepEqual(errors,[]);
} finally {
 await browser?.close();
 server.close();
}
