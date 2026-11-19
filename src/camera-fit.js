import * as T from 'three';
import { clamp } from './catalog.js';
import reference from './face-reference.json' with { type: 'json' };

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const mid = (a, b) => a.clone().lerp(b, .5);
const good = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const bridgeIndex = 168;
const ref = Array.from({ length: 468 }, (_, i) => V(
  (reference.vertices[i * 3] - reference.vertices[bridgeIndex * 3]) * .01,
  (reference.vertices[i * 3 + 1] - reference.vertices[bridgeIndex * 3 + 1]) * .01,
  (reference.vertices[i * 3 + 2] - reference.vertices[bridgeIndex * 3 + 2]) * .01,
));
const eyeSeparation = mid(ref[33], ref[133]).distanceTo(mid(ref[263], ref[362]));
const features = [
  [33, 1.5], [133, 1.5], [362, 1.5], [263, 1.5], [168, 2.4], [6, 2.1], [197, 1.25],
  [1, 1.2], [4, 1.05], [98, .7], [327, .7], [10, .92], [127, .87], [356, .87],
  [234, .66], [454, .66], [152, .54], [61, .43], [291, .43], [107, .6], [336, .6],
];
export const faceTriangles = new Uint16Array(reference.triangles);

export function projection(rect, view, horizontal = 63) {
  const focal = rect.w * .5 / Math.tan(clamp(horizontal, 42, 98) * Math.PI / 360);
  const cx = view.w * .5, cy = view.h * .5;
  const pixel = p => ({ x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h });
  const screen = p => ({ x: cx + focal * p.x / -p.z, y: cy - focal * p.y / -p.z });
  const ray = (p, depth) => {
    const sample = pixel(p);
    return V((sample.x - cx) * depth / focal, (cy - sample.y) * depth / focal, -depth);
  };
  const image = p => {
    const sample = screen(p);
    return { x: (sample.x - rect.x) / rect.w, y: (sample.y - rect.y) / rect.h };
  };
  return { focal, pixel, screen, ray, image, rect, view };
}

function solveLinear(rows, rhs) {
  const n = rhs.length;
  const m = rows.map((row, i) => [...row, rhs[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let k = c + 1; k < n; k++) {
      if (Math.abs(m[k][c]) > Math.abs(m[pivot][c])) pivot = k;
    }
    if (Math.abs(m[pivot][c]) < 1e-10) return null;
    [m[c], m[pivot]] = [m[pivot], m[c]];
    const divide = m[c][c];
    for (let k = c; k <= n; k++) m[c][k] /= divide;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const by = m[r][c];
      for (let k = c; k <= n; k++) m[r][k] -= by * m[c][k];
    }
  }
  return m.map(row => row[n]);
}

const quat = values => new T.Quaternion().setFromEuler(new T.Euler(values[0], values[1], values[2], 'YXZ'));

function posePoint(p, values, rotation, size) {
  return p.clone().multiplyScalar(size).applyQuaternion(rotation).add(V(values[3], values[4], -values[5]));
}

export function solveHead(points, camera, eyeMm = 63) {
  if (!points || ![33, 133, 263, 362, 168, 152].every(i => good(points[i]))) return null;
  const left = camera.pixel(points[33]), right = camera.pixel(points[263]);
  const width = Math.hypot(right.x - left.x, right.y - left.y);
  if (width < camera.rect.w * .038 || right.x <= left.x) return null;
  const size = clamp(eyeMm * .001 / eyeSeparation, .8, 1.23);
  const yaw = clamp((points[263].z - points[33].z) * camera.rect.w / Math.max(1, width), -.86, .86);
  const depth = clamp(camera.focal * ref[33].distanceTo(ref[263]) * size * Math.cos(yaw) / width, .22, 5);
  const anchor = camera.ray(points[bridgeIndex], depth);
  const initial = [0, yaw, Math.atan2(left.y - right.y, right.x - left.x), anchor.x, anchor.y, depth];
  const observed = features.filter(([i]) => good(points[i])).map(([i, w]) => ({ i, w, target: camera.pixel(points[i]) }));
  const horizon = Math.max(2.8, width * .047);
  const residuals = values => {
    const rotation = quat(values);
    return observed.flatMap(({ i, target }) => {
      const p = camera.screen(posePoint(ref[i], values, rotation, size));
      return [p.x - target.x, p.y - target.y];
    });
  };
  const cost = e => observed.reduce((sum, row, i) => {
    const length = Math.hypot(e[2 * i], e[2 * i + 1]);
    return sum + row.w * (length < horizon ? length * length : horizon * (2 * length - horizon));
  }, 0);
  let values = initial;
  let residual = residuals(values);
  for (let it = 0; it < 7; it++) {
    const eps = .0013;
    const jac = values.map((_, j) => {
      const step = [...values]; step[j] += eps;
      return residuals(step).map((x, i) => (x - residual[i]) / eps);
    });
    const weights = residual.map((_, i) => {
      const pair = Math.floor(i / 2);
      const length = Math.hypot(residual[pair * 2], residual[pair * 2 + 1]);
      return observed[pair].w * Math.min(1, horizon / Math.max(horizon, length));
    });
    const normal = jac.map((a, i) => jac.map((b, j) => {
      const value = a.reduce((sum, x, k) => sum + x * b[k] * weights[k], 0);
      return value + (i === j ? Math.max(1e-5, value * .008) : 0);
    }));
    const rhs = jac.map(a => -a.reduce((sum, x, k) => sum + x * residual[k] * weights[k], 0));
    const delta = solveLinear(normal, rhs);
    if (!delta) break;
    const current = cost(residual);
    let accepted = false;
    for (const step of [1, .45, .20]) {
      const next = values.map((v, i) => v + clamp(delta[i], i < 3 ? -.29 : -.30, i < 3 ? .29 : .30) * step);
      next[0] = clamp(next[0], -.80, .80);
      next[1] = clamp(next[1], -1.18, 1.18);
      next[2] = clamp(next[2], -.88, .88);
      next[5] = clamp(next[5], .21, 6);
      const errors = residuals(next);
      if (cost(errors) < current) { values = next; residual = errors; accepted = true; break; }
    }
    if (!accepted || Math.hypot(...delta) < .0006) break;
  }
  const rms = Math.sqrt(residual.reduce((sum, x) => sum + x * x, 0) / residual.length);
  if (!Number.isFinite(rms) || rms > width * .159 || Math.abs(values[1]) > 1.15) return null;
  const q = quat(values);
  const surface = ref.map((vertex, i) => {
    const model = posePoint(vertex, values, q, size);
    return good(points[i]) ? camera.ray(points[i], Math.max(.12, -model.z)) : model;
  });
  const forward = V(0, 0, 1).applyQuaternion(q);
  const bridge = surface[168].clone().lerp(surface[6], .22);
  const origin = bridge.clone().addScaledVector(forward, .0065);
  const eyes = [mid(surface[33], surface[133]), mid(surface[263], surface[362])];
  const temples = [mid(surface[127], surface[234]), mid(surface[356], surface[454])];
  return {
    kind: 'face', camera, q, origin, bridge, eyes, temples, surface, forward, depth: values[5], size,
    quality: clamp(1 - rms / (width * .19), .2, 1), reprojection: rms, yaw: values[1],
    faceCenter: camera.image(origin), imageRatio: camera.rect.w / camera.rect.h,
  };
}

export function rescaleHead(head, depth) {
  const scale = clamp(depth / head.depth, .57, 1.68);
  return { ...head, depth: head.depth * scale, surface: head.surface.map(p => p.clone().multiplyScalar(scale)),
    origin: head.origin.clone().multiplyScalar(scale), bridge: head.bridge.clone().multiplyScalar(scale) };
}

export function referencePoints() {
  return ref.map(p => p.clone());
}
