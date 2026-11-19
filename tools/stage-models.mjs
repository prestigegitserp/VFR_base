import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
const version = '0.10.32';
const target = new URL('../public/runtime/', import.meta.url);
const remote = 'https://storage.googleapis.com/mediapipe-models/';
const models = {
  pose: ['pose.task', 'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'],
  face: ['face.task', 'face_landmarker/face_landmarker/float16/1/face_landmarker.task'],
  mask: ['mask.tflite', 'image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite'],
};
await mkdir(target, { recursive: true });
const found = await Promise.all(Object.entries(models).map(async ([key, [name, path]]) => {
  const file = new URL(name,target);
  let bytes;
  try { bytes = await readFile(file); } catch {
    const response = await fetch(remote+path, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${name}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length < 20_000 || (key === 'mask' ? bytes.toString('ascii',4,8) !== 'TFL3' : bytes.toString('ascii',2,4) !== 'PK')) {
    throw new Error(`Unexpected asset bytes in ${name}`);
  }
  await writeFile(file,bytes);
  return [key,{ name, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex') }];
}));
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('wasm/',target),{recursive:true});
console.log(JSON.stringify(Object.fromEntries(found),null,2));
await writeFile(new URL('manifest.json',target),JSON.stringify({version,models:Object.fromEntries(found)})+'\n');
