import * as T from 'three';
import { clamp } from './catalog.js';

export const WORLD_HEIGHT = 1.98;
export const joint = { nose: 0, sl: 11, sr: 12, el: 13, er: 14, wl: 15, wr: 16, il: 19, ir: 20,
  hl: 23, hr: 24, kl: 25, kr: 26, al: 27, ar: 28 };
const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const mid = (a, b) => a.clone().lerp(b, .5);
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const confidence = p => finite(p) ? (p.visibility ?? 1) : 0;
export const confident = (p, min = .48) => confidence(p) >= min;
const inside = (p, margin = .035) => p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function contain(width, height, w, h) {
  const scale = Math.min(w / width, h / height);
  const x = width * scale, y = height * scale;
  return { x: (w - x) / 2, y: (h - y) / 2, w: x, h: y };
}

export class Temporal {
  constructor(anchors = [11, 12]) {
    this.anchors = anchors;
    this.clear();
  }
  update(next, time, response = 'steady') {
    if (!next) return null;
    const previous = this.value;
    const reset = !previous || previous.length !== next.length || time - this.when > 340 ||
      this.anchors.every(i => confident(next[i], .5) && finite(previous[i]) &&
        Math.hypot(next[i].x - previous[i].x, next[i].y - previous[i].y) > .225);
    if (reset) {
      this.value = next.map(p => ({ ...p }));
      this.velocity = next.map(() => V());
      this.when = time;
      return this.value;
    }
    const dt = clamp((time - this.when) * .001, .004, .21);
    const derivative = 1 - Math.exp(-dt * 15);
    this.value = next.map((p, i) => {
      const a = previous[i], speed = this.velocity[i];
      if (!finite(p) || !finite(a)) return { ...p };
      if (confidence(p) < .35) {
        speed.multiplyScalar(.35);
        return { ...a, visibility: confidence(p) };
      }
      const jump = V(p.x - a.x, p.y - a.y, (p.z - a.z) * .49);
      speed.lerp(jump.divideScalar(dt), derivative);
      const base = response === 'fast' ? 19 : 10;
      const alpha = clamp(1 - Math.exp(-dt * (base + speed.length() * 25)), .14, .97);
      return { x: a.x + (p.x - a.x) * alpha, y: a.y + (p.y - a.y) * alpha,
        z: a.z + (p.z - a.z) * alpha * .75, visibility: p.visibility };
    });
    this.when = time;
    return this.value;
  }
  clear() {
    this.value = null;
    this.when = 0;
    this.velocity = [];
  }
}

function imageMap(rect, view, mirror) {
  const scale = WORLD_HEIGHT / view.h;
  return {
    width: rect.w * scale,
    world: (p, z = 0) => V((rect.x + rect.w * (mirror ? 1 - p.x : p.x) - view.w / 2) * scale,
      (view.h / 2 - rect.y - rect.h * p.y) * scale, z),
    image: p => {
      const x = (p.x / scale + view.w / 2 - rect.x) / rect.w;
      return { x: mirror ? 1 - x : x, y: (view.h / 2 - p.y / scale - rect.y) / rect.h };
    },
  };
}

function basis(side, up) {
  const forward = V().crossVectors(side, up).normalize();
  if (forward.z < 0) forward.negate();
  const y = V().crossVectors(forward, side).normalize();
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side, y, forward));
}

export function faceRig(points, matrix, rect, view, mirror, body) {
  if (!points || ![points[33], points[263], points[152]].every(finite)) return null;
  const a = finite(points[468]) ? points[468] : points[33];
  const b = finite(points[473]) ? points[473] : points[263];
  const map = imageMap(rect, view, mirror);
  const centerZ = (a.z + b.z) * .5;
  const P = p => map.world(p, (centerZ - p.z) * map.width * .66);
  const eyes = [P(a), P(b)].sort((a, b) => a.x - b.x);
  const [left, right] = eyes;
  const center = mid(left, right);
  const axis = right.clone().sub(left);
  const span = axis.length();
  if (span < .031 || span > .91 || Math.abs(a.x - b.x) < .05) return null;
  axis.z = clamp(axis.z, -span * .67, span * .67);
  const chin = P(points[152]), top = center.clone().sub(chin);
  top.z = clamp(top.z, -top.length() * .3, top.length() * .3);
  if (matrix?.length === 16 && matrix.every(Number.isFinite)) {
    const turn = clamp(-matrix[6] * (mirror ? -1 : 1), -.42, .42) * span;
    axis.z = .76 * axis.z + .24 * turn;
  }
  const q = basis(axis.normalize(), top.normalize());
  center.y += span * .010;
  center.z = .012;
  const scale = span / ((body?.measures?.eye?.value ?? 63) * .001);
  return { origin: center, q, scale: V(scale, scale, scale), eyes, span, kind: 'face',
    quality: clamp(.80 + Math.abs(a.x - b.x), 0, 1), yaw: Math.asin(clamp(axis.z, -1, 1)),
    faceCenter: map.image(center), imageRatio: rect.w / rect.h, maskShift: { x: 0, y: 0 } };
}

const background = 0;
function maskReader(mask, shift = { x: 0, y: 0 }) {
  return (x, y) => {
    const u = Math.floor((x - shift.x) * mask.w), v = Math.floor((y - shift.y) * mask.h);
    return u >= 0 && u < mask.w && v >= 0 && v < mask.h ? mask.data[v * mask.w + u] : background;
  };
}

function shoulderFallback(face, mask, ratio) {
  if (!finite(face?.[152]) || !finite(face[10]) || !mask) return null;
  const chin = face[152], head = face[10], height = chin.y - head.y;
  if (height < .09 || chin.y + height * .22 > .94) return null;
  const read = maskReader(mask);
  const tissue = (x, y) => [2, 4].includes(read(x, y));
  const options = [];
  for (const offset of [.24, .35, .47, .59]) {
    const y = chin.y + height * offset;
    if (y >= .97 || !tissue(chin.x, y)) continue;
    const limit = Math.min(.43, height * 1.44 / ratio);
    let left = chin.x, right = chin.x;
    const step = 1 / mask.w;
    while (left > step && chin.x - left < limit && tissue(left - step, y)) left -= step;
    while (right < 1 - step && right - chin.x < limit && tissue(right + step, y)) right += step;
    const width = right - left;
    if (width * ratio < height * .98 || width > .8 || Math.min(chin.x - left, right - chin.x) < width * .22) continue;
    options.push({ left, right, width, y });
  }
  if (options.length < 2) return null;
  options.sort((a, b) => a.width - b.width);
  const { left, right, width, y } = options[Math.floor(options.length / 2)];
  const point = (x, y, visibility) => ({ x, y, z: 0, visibility });
  const points = Array.from({ length: 33 }, () => point(chin.x, chin.y, 0));
  points[joint.sl] = point(left + width * .12, y, .63);
  points[joint.sr] = point(right - width * .12, y, .63);
  return points;
}

function sectionAt(mask, shift, map, center, across, span, rect) {
  if (!mask) return { center, reliability: 0 };
  const read = maskReader(mask, shift);
  const at = d => map.image(center.clone().addScaledVector(across, d * span));
  const person = ({ x, y }) => {
    const c = read(x, y);
    return c === 2 || c === 4 || c === 5;
  };
  if (!person(at(0))) return { center, reliability: 0 };
  const step = Math.max(.024, rect.w / mask.w / (span / WORLD_HEIGHT * rect.h) * .7);
  function edge(sign) {
    let last = 0, gap = 0;
    for (let d = step; d <= .79; d += step) {
      const p = at(d * sign);
      if (p.x < .01 || p.x > .99 || p.y < .01 || p.y > .99) return { edge: last, open: true };
      if (person(p)) { last = d; gap = 0; }
      else if (++gap === 2) return { edge: last, open: false };
    }
    return { edge: last, open: true };
  }
  const l = edge(-1), r = edge(1), width = l.edge + r.edge;
  if (Math.min(l.edge, r.edge) < .16 || width < .46) return { center, reliability: 0 };
  const reliability = l.open || r.open ? .44 : .84;
  const offset = clamp((r.edge - l.edge) * .5, -.15, .15);
  return { center: center.clone().addScaledVector(across, span * offset * reliability),
    width: clamp(width, .58, 1.25) * span, reliability };
}

function neckFrom({ face, pose, map, origin, side, up, span }) {
  const chin = confident(face?.[152], .3) ? map.world(face[152]) : null;
  const mouth = [pose[9], pose[10]].filter(p => confident(p, .47) && inside(p));
  const candidate = chin ?? (mouth.length ? mouth.map(p => map.world(p)).reduce((a, b) => a.add(b), V()).divideScalar(mouth.length) : null);
  const v = candidate?.clone().sub(origin);
  const offset = v ? clamp(v.dot(side) * .55, -span * .19, span * .19) : 0;
  const lift = v ? clamp(v.dot(up) - span * (chin ? .07 : .15), span * .025, span * .138) : span * .076;
  const collar = origin.clone().addScaledVector(side, offset).addScaledVector(up, lift);
  return { collar, mouth: candidate ? map.image(candidate) : null };
}

export function bodyRig({ pose, world, face, mask, maskShift }, mode, rect, view, mirror, reference, profile) {
  if (!rect) return null;
  const imageRatio = rect.w / rect.h;
  const ok = p => confident(p, .49) && inside(p);
  const usable = p => ok(p?.[joint.sl]) && ok(p?.[joint.sr]);
  const tracked = usable(pose);
  const detected = tracked ? pose : mode === 'upper' ? shoulderFallback(face, mask, imageRatio) : null;
  if (!usable(detected)) return null;
  const j = joint, ls = detected[j.sl], rs = detected[j.sr];
  const map = imageMap(rect, view, mirror);
  const zCenter = (ls.z + rs.z) / 2;
  const shoulderIds = [[j.sl, j.el, j.wl, j.il, j.hl, j.kl, j.al], [j.sr, j.er, j.wr, j.ir, j.hr, j.kr, j.ar]];
  if (map.world(ls).x > map.world(rs).x) shoulderIds.reverse();
  const P = detected.map(p => finite(p) ? map.world(p, clamp((zCenter - p.z) * map.width * .67, -.75, .75)) : V());
  const shoulder = shoulderIds.map(([s]) => P[s].clone());
  const axis = shoulder[1].clone().sub(shoulder[0]);
  const span2D = Math.hypot(axis.x, axis.y);
  if (span2D < .095 || Math.abs(ls.x - rs.x) < .046 || Math.abs(axis.y) > span2D * .61) return null;
  const [sw0, sw1] = shoulderIds.map(([s]) => world?.[s]);
  const depth2D = clamp(axis.z / span2D, -1.3, 1.3);
  const depth3D = finite(sw0) && finite(sw1) ? clamp((sw0.z - sw1.z) /
    Math.max(.09, Math.hypot(sw0.x - sw1.x, sw0.y - sw1.y)), -1.3, 1.3) : null;
  const depth = tracked && depth3D != null ? depth3D * .62 + depth2D * .38 : depth2D;
  const yaw = Math.atan(depth);
  if (Math.abs(yaw) > .88 ||
      (tracked && !confident(detected[0], .34) && !confident(detected[7], .38) && !confident(detected[8], .38)
        && Math.abs(yaw) > .57)) return null;
  axis.z = span2D * depth;
  shoulder[0].z = -axis.z / 2;
  shoulder[1].z = axis.z / 2;
  const origin = mid(...shoulder), span = axis.length();
  const nominalShoulders = (profile?.measures?.shoulder?.value ?? reference.shoulder) * .001;
  const torsoLength = reference.torso;
  const hips = shoulderIds.map(side => P[side[4]]);
  const hipCenter = mid(...hips), canSeeHips = shoulderIds.every(s => ok(detected[s[4]]) && detected[s[4]].y < .984)
    && origin.y - hipCenter.y > span2D * .46;
  if (mode === 'full' && !canSeeHips) return null;
  const side = axis.normalize();
  const across = V(side.x, side.y).normalize();
  const referenceUp = V(-across.y, across.x);
  const hipUp = canSeeHips ? origin.clone().sub(hipCenter) : referenceUp.clone();
  const torsoDistance = canSeeHips ? hipUp.dot(referenceUp) : span * torsoLength / nominalShoulders;
  hipUp.z = clamp(hipUp.z, -torsoDistance * .29, torsoDistance * .29);
  const up = referenceUp.clone().lerp(hipUp.normalize(), canSeeHips ? .64 : 0).normalize();
  const q = basis(side, up);
  const sx = clamp(span / nominalShoulders, .27, 4.8);
  const sy = clamp(torsoDistance / torsoLength, sx * .61, sx * 1.45);
  const scale = V(sx, sy, sx * .74 + sy * .26);
  const { collar, mouth } = neckFrom({ face, pose: detected, map, origin, side: across, up: referenceUp, span: span2D });
  const waistLine = canSeeHips ? hipCenter : origin.clone().addScaledVector(up, -torsoDistance);
  const chest = sectionAt(mask, maskShift, map, origin.clone().lerp(waistLine, .29), across, span2D, rect);
  const waist = sectionAt(mask, maskShift, map, origin.clone().lerp(waistLine, .69), across, span2D, rect);
  const pelvis = sectionAt(mask, maskShift, map, waistLine, across, span2D, rect);
  const occluders = [], armQuality = [];
  const arms = shoulderIds.map(([s, e, w, i], index) => {
    const start = shoulder[index];
    const sign = index ? 1 : -1;
    const elbowScore = inside(detected[e] ?? {}, .135) ? confidence(detected[e]) : 0;
    const wristScore = inside(detected[w] ?? {}, .16) ? confidence(detected[w]) : 0;
    const down = up.clone().negate().addScaledVector(across, .13 * sign).normalize();
    const arm = (profile?.measures?.sleeve?.value ?? reference.sleeve ?? 600) * .001 * sy;
    const elbow = start.clone().addScaledVector(down, arm * .52);
    if (elbowScore >= .43) elbow.lerp(P[e], smooth(.42, .71, elbowScore));
    const lower = elbow.clone().sub(start).normalize().lerp(down, .56).normalize();
    const wrist = elbow.clone().addScaledVector(lower, arm * .48);
    if (wristScore >= .44 && elbowScore >= .39) wrist.lerp(P[w], smooth(.43, .72, wristScore));
    armQuality.push(Math.min(elbowScore, wristScore));
    if (wristScore >= .49) {
      const shoulderDepth = start.z;
      const front = smooth(span2D * .085, span2D * .30, wrist.z - shoulderDepth);
      const hand = confident(detected[i], .43) && inside(detected[i], .08) ? detected[i] : detected[w];
      occluders.push({ elbow: elbowScore >= .43 ? detected[e] : map.image(elbow), wrist: detected[w], hand,
        radius: span2D / map.width * .15, front });
    }
    return [start, elbow, wrist];
  });
  const leg = shoulderIds.flatMap(idx => idx.slice(4).every(k => ok(detected[k])) ? [idx.slice(4).map(k => P[k])] : []);
  const quality = tracked ? clamp((confidence(ls) + confidence(rs)) * .40 + (canSeeHips ? .09 : .025)
    + chest.reliability * .10, 0, 1) : .54;
  const screenSpan = span2D / map.width;
  const screenSide = map.image(origin.clone().add(across));
  const screenCenter = map.image(origin);
  return { origin, q, scale, arms, leg, occluders, shoulder, hip: canSeeHips ? hips : null,
    kind: tracked ? 'body' : 'estimate', full: leg.length === 2, span: span2D, depthSpan: span, quality, yaw,
    collar, sections: { chest, waist, hip: pelvis }, armQuality, mouth, maskShift,
    screenSpan, imageRatio, screenCenter, screenCollar: map.image(collar),
    screenSlope: (screenSide.y - screenCenter.y) / (screenSide.x - screenCenter.x),
  };
}
