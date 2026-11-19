import { clamp } from './catalog.js';

export const HEIGHT = 4.16;
export const JOINT = {
  nose: 0, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28, leftHeel: 29, rightHeel: 30,
};
const j = JOINT;
const core = [j.leftShoulder, j.rightShoulder, j.leftHip, j.rightHip];
const limb = [
  [j.leftShoulder, j.leftElbow, j.leftWrist, j.leftIndex, j.leftHip, j.leftKnee, j.leftAnkle],
  [j.rightShoulder, j.rightElbow, j.rightWrist, j.rightIndex, j.rightHip, j.rightKnee, j.rightAnkle],
];
const lerp = (a, b, t) => a + (b - a) * t;
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const confident = (p, min = .5) => p && (p.visibility ?? 1) >= min && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const inFrame = (p) => p.x > .015 && p.x < .985 && p.y > .018 && p.y < .982;

export function containRect(sourceWidth, sourceHeight, width, height) {
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const w = scale * sourceWidth, h = scale * sourceHeight;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function project(p, rect, mirror) {
  return { x: rect.x + (mirror ? 1 - p.x : p.x) * rect.w, y: rect.y + p.y * rect.h };
}

export function validPose(landmarks) {
  if (!landmarks || !core.every((i) => confident(landmarks[i], .52))) return false;
  const top = mid(landmarks[j.leftShoulder], landmarks[j.rightShoulder]);
  const hip = mid(landmarks[j.leftHip], landmarks[j.rightHip]);
  const width = Math.abs(landmarks[j.leftShoulder].x - landmarks[j.rightShoulder].x);
  return width > .061 && Math.hypot(top.x - hip.x, top.y - hip.y) > .108;
}

export class PoseSmoother {
  points = null;
  timestamp = 0;

  clear() { this.points = null; }

  update(next, time) {
    if (!this.points || time - this.timestamp > 550) {
      this.points = next.map((p) => ({ ...p }));
    } else {
      const dt = clamp((time - this.timestamp) / 1000, 1 / 120, .2);
      this.points = next.map((p, i) => {
        const a = this.points[i];
        const delta = Math.hypot(p.x - a.x, p.y - a.y);
        const alpha = clamp(1 - Math.exp(-dt * (12 + 66 * delta)), .18, .82);
        return {
          x: lerp(a.x, p.x, alpha), y: lerp(a.y, p.y, alpha),
          z: lerp(a.z, p.z, alpha * .73), visibility: p.visibility,
        };
      });
    }
    this.timestamp = time;
    return this.points;
  }
}

export function projectRig(landmarks, rect, width, height, mirror) {
  const sh = mid(landmarks[j.leftShoulder], landmarks[j.rightShoulder]);
  const floor = mid(landmarks[j.leftHip], landmarks[j.rightHip]);
  const scale = HEIGHT / height;
  const shoulderDelta = landmarks[j.leftShoulder].x - landmarks[j.rightShoulder].x;
  const leftFirst = mirror ? shoulderDelta > 0 : shoulderDelta < 0;
  const ordered = leftFirst ? limb : [...limb].reverse();
  const toWorld = (p) => {
    const plotted = project(p, rect, mirror);
    return {
      x: (plotted.x - width / 2) * scale,
      y: (height / 2 - plotted.y) * scale,
      z: clamp(-(p.z - sh.z) * rect.w * scale * .7, -1.4, 1.4),
    };
  };
  const pose = {
    shoulders: ordered.map(([s]) => toWorld(landmarks[s])),
    hips: ordered.map((side) => toWorld(landmarks[side[4]])),
    elbows: [], wrists: [], hands: [], knees: [], ankles: [],
    armVisibility: [], legVisibility: [],
  };
  ordered.forEach(([s, e, w, h, hip, knee, ankle], index) => {
    const shoulder = landmarks[s];
    const pelvis = landmarks[hip];
    const direction = index ? 1 : -1;
    const side = mirror ? -direction : direction;
    const width = Math.abs(shoulderDelta);
    const torso = Math.abs(floor.y - sh.y);
    const elbow = confident(landmarks[e], .46) ? landmarks[e] : { x: shoulder.x + side * width * .21, y: shoulder.y + torso * .66, z: shoulder.z };
    const wrist = confident(landmarks[w], .46) ? landmarks[w] : { x: elbow.x + side * width * .1, y: elbow.y + torso * .61, z: elbow.z };
    const kneePoint = confident(landmarks[knee], .53) ? landmarks[knee] : { ...pelvis, y: pelvis.y + torso * .91 };
    const anklePoint = confident(landmarks[ankle], .53) ? landmarks[ankle] : { ...kneePoint, y: kneePoint.y + torso * .9 };
    pose.elbows.push(toWorld(elbow));
    pose.wrists.push(toWorld(wrist));
    pose.hands.push(toWorld(confident(landmarks[h], .46) ? landmarks[h] : wrist));
    pose.knees.push(toWorld(kneePoint));
    pose.ankles.push(toWorld(anklePoint));
    pose.armVisibility.push([landmarks[e], landmarks[w]].every((p) => confident(p, .6)));
    pose.legVisibility.push([landmarks[knee], landmarks[ankle]].every((p) => confident(p, .55)));
  });
  pose.nose = toWorld(landmarks[j.nose] ?? sh);
  return pose;
}

function measure(landmarks, mask, heightCm, aspect) {
  const needed = [j.nose, ...core, j.leftElbow, j.rightElbow, j.leftAnkle, j.rightAnkle, j.leftHeel, j.rightHeel];
  if (!mask || !needed.every((i) => confident(landmarks[i], .68) && inFrame(landmarks[i]))) return null;
  const sl = landmarks[j.leftShoulder], sr = landmarks[j.rightShoulder];
  const s = mid(sl, sr), h = mid(landmarks[j.leftHip], landmarks[j.rightHip]);
  const shoulder = Math.abs(sl.x - sr.x);
  const elbows = [landmarks[j.leftElbow], landmarks[j.rightElbow]].map((p) => p.x).sort((a, b) => a - b);
  if (Math.abs(sl.z - sr.z) > shoulder * .42 || Math.abs(sl.y - sr.y) > shoulder * .19) return null;
  if (elbows[1] - elbows[0] < shoulder * 1.15 || Math.abs(h.x - s.x) > shoulder * .22) return null;
  const noseY = landmarks[j.nose].y;
  const crown = noseY - clamp((s.y - noseY) * .54, .035, .088);
  const foot = Math.max(landmarks[j.leftHeel].y, landmarks[j.rightHeel].y);
  const stature = foot - crown;
  if (crown <= .003 || stature < .45 || stature > .98) return null;
  const { width, height } = mask;
  const data = mask.getAsFloat32Array();
  const span = (blend) => {
    const x = Math.round(lerp(s.x, h.x, blend) * (width - 1));
    const y = Math.round(lerp(s.y, h.y, blend) * (height - 1));
    let l = x, r = x;
    const row = y * width;
    if (data[row + x] < .5) return 0;
    while (l > 0 && data[row + l - 1] >= .5) l--;
    while (r < width - 1 && data[row + r + 1] >= .5) r++;
    return (r - l + 1) / width;
  };
  const cm = (u) => u * aspect / stature * heightCm;
  const perimeter = (diameter, depthRatio) => {
    const a = diameter / 2, b = a * depthRatio;
    return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  };
  const spans = [.23, .68, 1].map(span);
  if (spans.some((w) => w < shoulder * .63 || w > shoulder * 1.22)) return null;
  const [chest, waist, hips] = spans.map((w, i) => perimeter(cm(w), [.7, .73, .68][i]));
  const shoulderCm = cm(shoulder);
  if (shoulderCm < 26 || shoulderCm > 61 || [chest, waist, hips].some((v) => v < 46 || v > 180)) return null;
  return { chest, waist, hips, shoulder: shoulderCm, stature };
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export class Calibration {
  static count = 22;
  constructor(height) { this.height = height; this.samples = []; }

  push(landmarks, mask, aspect) {
    const row = measure(landmarks, mask, this.height, aspect);
    if (!row) return false;
    if (this.samples.length >= 6 && Math.abs(row.stature - median(this.samples.map((s) => s.stature))) > .043) {
      this.samples = [];
    }
    this.samples.push(row);
    return true;
  }

  result() {
    if (this.samples.length < Calibration.count) return null;
    return Object.fromEntries(['chest', 'waist', 'hips', 'shoulder'].map((k) => [k, Math.round(median(this.samples.map((s) => s[k])))]));
  }
}
