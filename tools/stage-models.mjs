import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';

const version = '0.10.32';
const target = new URL('../public/runtime/', import.meta.url);
const task = new URL('pose.task', target);
const url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
await mkdir(target, { recursive: true });
let bytes;
try {
  await access(task);
  bytes = await readFile(task);
} catch {
  const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`Could not download the pose model (${response.status})`);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (bytes.length < 4_000_000 || bytes[2] !== 80 || bytes[3] !== 75) throw new Error('Unexpected MediaPipe model file');
await writeFile(task, bytes);
await cp(new URL('../node_modules/@mediapipe/tasks-vision/wasm/', import.meta.url), new URL('wasm/', target), { recursive: true });
await writeFile(new URL('manifest.json', target), JSON.stringify({ version, model: 'pose_landmarker_full/float16/1', sha256: createHash('sha256').update(bytes).digest('hex') }) + '\n');
console.log('Prepared MediaPipe runtime and pose model.');
