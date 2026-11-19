import { clamp, metrics } from './catalog.js';

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

export function scanSample(points, mask, aspect, heightMm, side) {
  if (!mask || !points || !Number.isFinite(aspect)) return null;
  const [nose, left, right, leftHip, rightHip, leftFoot, rightFoot] = [0, 11, 12, 23, 24, 29, 30].map((i) => points[i]);
  if ([nose, left, right, leftHip, rightHip, leftFoot, rightFoot].some((p) => !p || (p.visibility ?? 1) < (side ? .35 : .63) || p.x < .01 || p.x > .99 || p.y < .015 || p.y > .985)) return null;
  const shoulderX = (left.x + right.x) / 2;
  const shoulderY = (left.y + right.y) / 2;
  const hipX = (leftHip.x + rightHip.x) / 2;
  const hipY = (leftHip.y + rightHip.y) / 2;
  const crown = nose.y - clamp((shoulderY - nose.y) * .59, .035, .095);
  const bottom = Math.max(leftFoot.y, rightFoot.y) + .009;
  const span = bottom - crown;
  const visibleShoulders = Math.abs(right.x - left.x) * aspect / span * heightMm;
  const turn = Math.abs(left.z - right.z) / Math.max(.015, Math.abs(left.x - right.x));
  if (crown < .01 || bottom > .99 || span < .49 || hipY - shoulderY < .13 || Math.abs(left.y - right.y) > .047) return null;
  if (side ? visibleShoulders > 275 || turn < .61 : visibleShoulders < 267 || visibleShoulders > 635 || turn > .52) return null;
  const sample = { stature: span, shoulder: visibleShoulders };
  for (const [key, position] of [['chest', .23], ['waist', .69], ['hip', 1.01]]) {
    const w = sliceBand(mask, shoulderX + (hipX - shoulderX) * position, shoulderY + (hipY - shoulderY) * position);
    sample[key] = w * aspect / span * heightMm;
    if (sample[key] < (side ? 95 : 205) || sample[key] > (side ? 440 : 600)) return null;
  }
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
      const value = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
      const spread = median(f.map((x) => Math.abs(x - a * 2))) + median(s.map((x) => Math.abs(x - b * 2)));
      measures[key] = { value: Math.round(value), uncertainty: Math.round(clamp(52 + spread * 2.6, 52, 125)) };
    }
    measures.shoulder = { value: Math.round(median(this.front.map((p) => p.shoulder))), uncertainty: 28 };
    return { method: 'camera', measures };
  }
}
