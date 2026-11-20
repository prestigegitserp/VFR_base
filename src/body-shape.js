import { clamp } from './catalog.js';

export const levels = [.12, .20, .29, .38, .48, .59, .69, .80, .91, 1];
const widthRatio = [.422, .435, .446, .445, .422, .397, .385, .394, .420, .432];
const depthRatio = [.203, .225, .245, .250, .237, .226, .217, .220, .231, .239];
const measures = [['chest', .38], ['waist', .69], ['hip', 1]];
export const mix = (a, b, t) => a + (b - a) * t;

export function perimeter(a, b) {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function adjustment(t, gains) {
  if (t <= gains[0][0]) return gains[0][1];
  for (let i = 1; i < gains.length; i++) {
    const [end, b] = gains[i], [start, a] = gains[i - 1];
    if (t <= end) return mix(a, b, (t - start) / (end - start));
  }
  return gains.at(-1)[1];
}

function validScan(scan) {
  return scan?.version === 1 && Number.isFinite(scan.length) && scan.length > .26 && scan.length < .76 &&
    scan.sections?.length === levels.length && scan.sections.every(s =>
      Number.isFinite(s?.rx) && s.rx >= .065 && s.rx <= .34 && Number.isFinite(s.rz) && s.rz >= .034 && s.rz <= .26);
}

export function shapeSections(width, profile, observations = []) {
  const scan = validScan(profile?.shape) ? profile.shape : null;
  const rings = levels.map((t, i) => {
    const observed = observations[i];
    const priorWidth = width * widthRatio[i];
    const rx = scan ? scan.sections[i].rx :
      mix(priorWidth, observed?.rx ?? priorWidth, (observed?.weight ?? 0) * .73);
    const rz = scan ? scan.sections[i].rz : width * depthRatio[i] * clamp((rx / priorWidth) ** .52, .84, 1.18);
    return { t, rx, rz };
  });
  const gains = measures.map(([key, t]) => {
    const m = profile?.measures?.[key];
    const row = rings[levels.indexOf(t)];
    // Known girths constrain both axes while a scan retains its measured width-to-depth ratio.
    const gain = m && !(scan && profile.method === 'camera' && m.uncertainty > 26)
      ? clamp(m.value * .001 / perimeter(row.rx, row.rz), .70, 1.55)
      : 1;
    return [t, gain];
  });
  for (const ring of rings) {
    const gain = adjustment(ring.t, gains);
    ring.rx *= gain;
    ring.rz *= gain;
  }
  return { rings, length: scan?.length, source: scan ? 'two-view' : Object.values(profile?.measures ?? {}).length ? 'measured' : 'image' };
}
