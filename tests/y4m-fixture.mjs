import { readFile, writeFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';

const [source, target] = process.argv.slice(2);
const image = jpeg.decode(await readFile(source), { useTArray: true });
const scale = Math.min(1, 960 / image.width);
const width = Math.floor(image.width * scale / 2) * 2;
const height = Math.floor(image.height * scale / 2) * 2;
function frame(phase){
  const luma = new Uint8Array(width * height);
  const cb = new Uint8Array(width * height / 4);
  const cr = new Uint8Array(width * height / 4);
  const shift=Math.round(width*.069*Math.sin(phase));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX=Math.max(0,Math.min(width-1,x-shift));
      const i = (Math.floor(y * image.height / height) * image.width + Math.floor(sourceX * image.width / width)) * 4;
      const r=image.data[i],g=image.data[i+1],b=image.data[i+2];
      luma[y * width + x] = Math.round(16 + .257 * r + .504 * g + .098 * b);
      if (x % 2 === 0 && y % 2 === 0) {
        const at = (y * width / 2 + x) / 2;
        cb[at] = Math.round(128 - .148 * r - .291 * g + .439 * b);
        cr[at] = Math.round(128 + .439 * r - .368 * g - .071 * b);
      }
    }
  }
  return Buffer.concat([Buffer.from('FRAME\n'), luma, cb, cr]);
}

const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F16:1 Ip A1:1 C420jpeg\n`);
const frames=Array.from({length:43},(_,i)=>frame(i/43*Math.PI*2));
await writeFile(target, Buffer.concat([header, ...frames]));
