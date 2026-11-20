import { clamp, metrics } from './catalog.js';
import { levels, perimeter } from './body-shape.js';

const profileStyle = {
  close: { label: 'نزدیک به بدن', place: .24 },
  regular: { label: 'معمولی', place: .49 },
  relaxed: { label: 'آزاد', place: .76 },
};
export const styles = profileStyle;

export function manualProfile(fields) {
  const measures = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!Object.hasOwn(metrics, key)) continue;
    const [min, max] = metrics[key].range;
    if (!Number.isFinite(value) || value < min || value > max) continue;
    measures[key] = { value: Math.round(value), uncertainty: key === 'eye' || key === 'bridge' ? 1 : 5 };
  }
  return { method: 'manual', measures };
}

export function checkSize(item, size, profile, preference = 'regular') {
  if (!item.sizes.includes(size)) throw new Error('This size does not belong to the item');
  const keys = Object.keys(item.ease);
  const checks = keys.map((key) => {
    const definition = item.ease[key];
    const measure = profile?.measures?.[key];
    if (!measure || !Number.isFinite(measure.value) || !Number.isFinite(measure.uncertainty)) return { key, status: 'missing' };
    const [min, max] = definition;
    const raw = size.garment[key] - measure.value;
    const margin = size.toleranceMm + measure.uncertainty;
    const low = raw - margin, high = raw + margin;
    const status = high < min ? 'tight' : low > max ? 'loose'
      : low >= min && high <= max ? 'clear' : 'uncertain';
    const place = (profileStyle[preference] ?? profileStyle.regular).place;
    return { key, status, raw, low, high, min, max, score: Math.abs((raw - min) / (max - min) - place) };
  });
  const veto = checks.some((c) => c.status === 'tight' || c.status === 'loose');
  const complete = checks.every((c) => c.status !== 'missing');
  const clear = complete && checks.every((c) => c.status === 'clear');
  const score = checks.reduce((n, c) => n + (c.score ?? 2), 0) / keys.length;
  return { size, checks, status: veto ? 'incompatible' : !complete ? 'insufficient' : !clear ? 'borderline' : profile.method === 'camera' ? 'estimate' : 'match', score };
}

export function chooseSize(item, profile, preference) {
  if (!profile) return null;
  const ranks = { match: 0, estimate: 1, borderline: 2, insufficient: 3, incompatible: 4 };
  const checks = item.sizes.map((size) => checkSize(item, size, profile, preference));
  checks.sort((a, b) => ranks[a.status] - ranks[b.status] || a.score - b.score);
  return checks[0].status === 'incompatible' ? null : checks[0];
}

export function measureValue(profile, key, fallback) {
  return profile?.measures?.[key]?.value ?? fallback;
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

function sliceBand(mask, landmarkX, atY) {
  const { data, w, h } = mask;
  const y = Math.round(clamp(atY, .008, .992) * (h - 1));
  const middle = Math.round(clamp(landmarkX, .01, .99) * (w - 1));
  const measurements = [];
  for (let dy = -1; dy <= 1; dy++) {
    const i = clamp(y + dy, 0, h - 1) * w;
    if (data[i + middle] === 0) continue;
    let left = middle, right = middle;
    while (left > 1 && data[i + left - 1] !== 0) left--;
    while (right < w - 2 && data[i + right + 1] !== 0) right++;
    measurements.push((right - left + 1) / w);
  }
  return measurements.length ? median(measurements) : 0;
}

function foregroundEnd(mask, start, limit, sign) {
  const { data, w, h } = mask;
  for (let y = start; sign * (limit - y) > 0; y += sign) {
    const row = clamp(Math.round(y * h), 1, h - 2) * w;
    let run = 0;
    for (let x = 2; x < w - 2; x++) {
      run = data[row + x] ? run + 1 : 0;
      if (run >= 3) return y;
    }
  }
  return limit;
}

export function scanSample(points, mask, aspect, heightMm, side) {
  if (!mask || !points || !Number.isFinite(aspect)) return null;
  const [nose, left, right, leftHip, rightHip, leftFoot, rightFoot] = [0, 11, 12, 23, 24, 29, 30].map((i) => points[i]);
  if ([nose, left, right, leftHip, rightHip, leftFoot, rightFoot].some((p) => !p || (p.visibility ?? 1) < (side ? .35 : .63) || p.x < .01 || p.x > .99 || p.y < .015 || p.y > .985)) return null;
  const shoulderX = (left.x + right.x) / 2;
  const shoulderY = (left.y + right.y) / 2;
  const hipX = (leftHip.x + rightHip.x) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const headGuess = nose.y - clamp((shoulderY - nose.y) * .59, .032, .093);
  const heel = Math.max(leftFoot.y, rightFoot.y);
  const crown = foregroundEnd(mask, Math.max(.004, headGuess - .044), nose.y - .014, 1 / mask.h);
  const bottom = foregroundEnd(mask, Math.min(.996, heel + .057), heel, -1 / mask.h);
  const span = bottom - crown;
  const visibleShoulders = Math.abs(right.x - left.x) * aspect / span * heightMm;
  const turn = Math.abs(left.z - right.z) / Math.max(.015, Math.abs(left.x - right.x));
  if (crown < .01 || bottom > .99 || span < .49 || hipY - shoulderY < .13 || Math.abs(left.y - right.y) > .047) return null;
  if (side ? visibleShoulders > 275 || turn < .61 : visibleShoulders < 267 || visibleShoulders > 635 || turn > .52) return null;
  const ratio = aspect / span * heightMm;
  const torso = (hipY - shoulderY) / span * heightMm;
  const profile = levels.map(t => sliceBand(mask, shoulderX + (hipX - shoulderX) * t, shoulderY + (hipY - shoulderY) * t) * ratio);
  if (profile.some(w => w < (side ? 83 : 156) || w > (side ? 470 : 662))) return null;
  const sample = { stature: span, shoulder: visibleShoulders, torso, profile, chest: profile[3], waist: profile[6], hip: profile.at(-1) };
  return sample;
}

export class TwoViewScan {
  constructor(height) {
    this.height = height;
    this.view = 'front';
    this.front = [];
    this.side = [];
  }
  ingest(points, mask, aspect) {
    if (!['front', 'side'].includes(this.view)) return false;
    const results = this[this.view];
    const next = scanSample(points, mask, aspect, this.height, this.view === 'side');
    if (!next) return false;
    if (results.length >= 4 && Math.abs(next.stature - median(results.map((p) => p.stature))) > .038) return false;
    results.push(next);
    if (results.length >= 8) this.view = this.view === 'front' ? 'turn' : 'complete';
    return true;
  }
  result() {
    if (this.view !== 'complete') return null;
    const measures = { height: { value: this.height, uncertainty: 5 } };
    for (const key of ['chest', 'waist', 'hip']) {
      const f = this.front.map((p) => p[key]);
      const s = this.side.map((p) => p[key]);
      const a = median(f) / 2, b = median(s) / 2;
      const value = perimeter(a, b);
      const spread = median(f.map((x) => Math.abs(x - a * 2))) + median(s.map((x) => Math.abs(x - b * 2)));
      measures[key] = { value: Math.round(value), uncertainty: Math.round(clamp(52 + spread * 2.6, 52, 125)) };
    }
    measures.shoulder = { value: Math.round(median(this.front.map((p) => p.shoulder))), uncertainty: 28 };
    const scan = { method: 'camera', measures };
    const all = this.front.concat(this.side);
    if (all.every(p => Number.isFinite(p.torso) && p.profile?.length === levels.length)) {
      const sections = levels.map((_, i) => {
        const observation = view => median(view.map(sample => {
          const a = sample.profile[Math.max(0, i - 1)];
          const b = sample.profile[i];
          const c = sample.profile[Math.min(levels.length - 1, i + 1)];
          return (a + 4 * b + c) / 6;
        })) * .0005;
        return { rx: observation(this.front), rz: observation(this.side) };
      });
      scan.shape = { version: 1, length: median(all.map(p => p.torso)) * .001, sections };
    }
    return scan;
  }
}
