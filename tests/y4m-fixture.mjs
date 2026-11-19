import { readFile, writeFile } from 'node:fs/promises';
import jpeg from 'jpeg-js';

const [source, target] = process.argv.slice(2);
const image = jpeg.decode(await readFile(source), { useTArray: true });
const scale = Math.min(1, 960 / image.width);
const width = Math.floor(image.width * scale / 2) * 2;
const height = Math.floor(image.height * scale / 2) * 2;
const luma = new Uint8Array(width * height);
const cb = new Uint8Array(width * height / 4);
const cr = new Uint8Array(width * height / 4);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (Math.floor(y * image.height / height) * image.width + Math.floor(x * image.width / width)) * 4;
    const [r, g, b] = image.data.subarray(i, i + 3);
    luma[y * width + x] = Math.round(16 + .257 * r + .504 * g + .098 * b);
    if (x % 2 === 0 && y % 2 === 0) {
      const at = (y * width / 2 + x) / 2;
      cb[at] = Math.round(128 - .148 * r - .291 * g + .439 * b);
      cr[at] = Math.round(128 + .439 * r - .368 * g - .071 * b);
    }
  }
}

const header = Buffer.from(`YUV4MPEG2 W${width} H${height} F20:1 Ip A1:1 C420jpeg\n`);
const frame = Buffer.concat([Buffer.from('FRAME\n'), luma, cb, cr]);
await writeFile(target, Buffer.concat([header, ...Array(20).fill(frame)]));
