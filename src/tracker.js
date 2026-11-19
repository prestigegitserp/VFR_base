import { asset } from './catalog.js';

const VERSION = '0.10.32';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const ALT = `https://unpkg.com/@mediapipe/tasks-vision@${VERSION}/wasm`;

async function fetchOK(url, timeout) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`Asset HTTP ${response.status}: ${url}`);
  return response;
}

async function createTracker() {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
  let bundled = false;
  try {
    const marker = await (await fetchOK(asset('runtime/manifest.json'), 2800)).json();
    bundled = marker.version === VERSION;
  } catch { /* The dev server can use the same pinned assets from their origins. */ }
  const attempts = bundled
    ? [{ wasm: asset('runtime/wasm/'), model: asset('runtime/pose.task') }, { wasm: CDN, model: MODEL }]
    : [{ wasm: CDN, model: MODEL }, { wasm: ALT, model: MODEL }];
  let failure;

  for (const { wasm, model } of attempts) {
    try {
      const [files, response] = await Promise.all([
        FilesetResolver.forVisionTasks(wasm.replace(/\/$/, '')),
        fetchOK(model, 20000),
      ]);
      const modelAssetBuffer = new Uint8Array(await response.arrayBuffer());
      for (const delegate of ['GPU', 'CPU']) {
        try {
          const task = await PoseLandmarker.createFromOptions(files, {
            baseOptions: { modelAssetBuffer, delegate },
            canvas: document.createElement('canvas'), runningMode: 'VIDEO', numPoses: 1,
            minPoseDetectionConfidence: .54, minPosePresenceConfidence: .5, minTrackingConfidence: .52,
            outputSegmentationMasks: false,
          });
          let mode = 'VIDEO', segmentation = false;
          return {
            delegate,
            async options(nextMode, nextSegmentation = false) {
              if (mode === nextMode && segmentation === nextSegmentation) return;
              await task.setOptions({ runningMode: nextMode, outputSegmentationMasks: nextSegmentation });
              mode = nextMode;
              segmentation = nextSegmentation;
            },
            video: (source, timestamp, callback) => task.detectForVideo(source, timestamp, callback),
            image: (source, callback) => task.detect(source, callback),
            close: () => task.close(),
          };
        } catch (error) { failure = error; }
      }
    } catch (error) { failure = error; }
  }
  throw failure ?? new Error('Pose model unavailable');
}

let pending;
export function getTracker() {
  pending ??= createTracker().catch((error) => {
    pending = null;
    throw error;
  });
  return pending;
}
