import * as T from 'three';
import { clamp } from './catalog.js';
import { headJoint, rescaleHead } from './camera-fit.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const mix = (a, b, t) => a + (b - a) * t;
const center = (a, b) => a.clone().lerp(b, .5);
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const visible = (p, c = .52, margin = .05) => finite(p) && (p.visibility ?? 1) >= c &&
  p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin;
const sides = [[11, 13, 15, 19, 23, 25, 27], [12, 14, 16, 20, 24, 26, 28]];
const clothed = label => label === 2 || label === 4;

function readMask(mask, shift = { x: 0, y: 0 }) {
  return (x, y) => {
    if (!mask) return 0;
    const u = Math.floor((x - shift.x) * mask.w), v = Math.floor((y - shift.y) * mask.h);
    return u >= 0 && u < mask.w && v >= 0 && v < mask.h ? mask.data[v * mask.w + u] : 0;
  };
}

function traceRow(read, mask, x, y, limit) {
  if (!mask || !clothed(read(x, y))) return null;
  const step = 1 / mask.w;
  const edge = sign => {
    let end = x, misses = 0;
    for (let d = step; d < limit; d += step) {
      const u = x + sign * d;
      if (u <= step || u >= 1 - step) return { u: end, open: true };
      if (clothed(read(u, y))) { end = u; misses = 0; }
      else if (++misses >= 2) return { u: end, open: false };
    }
    return { u: end, open: true };
  };
  const l = edge(-1), r = edge(1);
  if (r.u - l.u < .045 || Math.min(x - l.u, r.u - x) < .017) return null;
  return { left: l.u, right: r.u, width: r.u - l.u, trust: l.open || r.open ? .33 : .88 };
}

function seatedFallback(face, read, mask, aspect) {
  if (!finite(face?.[152]) || !finite(face[10]) || !mask) return null;
  const chin = face[152], height = chin.y - face[10].y;
  if (height < .09 || chin.y > .94) return null;
  const rows = [];
  const max = Math.min(.45, height * 1.4 / aspect);
  for (const offset of [.085, .16, .25, .37, .49]) {
    const y = chin.y + height * offset;
    if (y > .978) continue;
    const row = traceRow(read, mask, chin.x, y, max);
    if (!row || row.width * aspect < height * .85 || row.width * aspect > height * 2.9) continue;
    rows.push({ ...row, y });
  }
  if (rows.length < 2) return null;
  const row = rows.sort((a, b) => a.width - b.width)[Math.floor(rows.length * .55)];
  return [{ x: row.left + row.width * .075, y: row.y, z: 0, visibility: .61 },
    { x: row.right - row.width * .075, y: row.y, z: 0, visibility: .61 }];
}

function topOfShoulder(read, mask, p, inward, vertical) {
  if (!mask) return null;
  const estimates = [];
  const step = 1 / mask.h;
  for (const fraction of [.055, .105, .16]) {
    const x = mix(p.x, inward, fraction);
    let hits = 0;
    for (let y = p.y - vertical * .28; y <= p.y + vertical * .065; y += step) {
      if (clothed(read(x, y)) && clothed(read(x, y + step * 4))) {
        if (++hits >= 2) { estimates.push(y - step); break; }
      } else hits = 0;
    }
  }
  if (estimates.length < 2) return null;
  estimates.sort((a, b) => a - b);
  return { x: p.x, y: estimates[Math.floor(estimates.length / 2)] };
}

function axes(shoulders, hips) {
  const side = shoulders[1].clone().sub(shoulders[0]).normalize();
  const across = V(side.x, side.y).normalize();
  const lifted = V(-across.y, across.x, 0);
  if (hips) {
    const torso = center(...shoulders).sub(center(...hips));
    torso.z = clamp(torso.z, -.18, .18);
    lifted.lerp(torso.normalize(), .58);
  }
  const forward = V().crossVectors(side, lifted).normalize();
  const up = V().crossVectors(forward, side).normalize();
  return { side, up, forward, q: new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side, up, forward)) };
}

function attachHead(head, ideal, depth, width) {
  const joint = headJoint(head);
  const distance = joint.length();
  const ray = joint.clone().divideScalar(distance);
  const along = ray.dot(ideal);
  const radialError = ray.clone().multiplyScalar(along).distanceTo(ideal);
  if (radialError > width * .45) return null;
  const tolerance = width * .26;
  const slide = Math.sqrt(Math.max(.00065, tolerance * tolerance - radialError * radialError));
  const multiplier = clamp(mix(depth / head.depth, along / distance, .65), (along - slide) / distance, (along + slide) / distance);
  return rescaleHead(head, head.depth * multiplier);
}

export function solveBody(input, mode, camera, head, profile) {
  const { pose, world, face, mask, maskShift } = input;
  const read = readMask(mask, maskShift);
  const aspect = camera.rect.w / camera.rect.h;
  let shoulders2d = sides.map(ids => pose?.[ids[0]]);
  const poseStable = shoulders2d.every(p => visible(p, .47, .075));
  const estimated = !poseStable;
  if (estimated) {
    if (mode !== 'upper') return null;
    shoulders2d = seatedFallback(face, read, mask, aspect);
    if (!shoulders2d) return null;
  }
  const order = shoulders2d[0].x < shoulders2d[1].x ? [0, 1] : [1, 0];
  const points = order.map(i => shoulders2d[i]);
  const indices = order.map(i => sides[i]);
  const span = points[1].x - points[0].x;
  const vertical = span * aspect;
  const meanZ = (points[0].z + points[1].z) * .5;
  if (span < .059 || Math.abs(points[0].y - points[1].y) > vertical * .61) return null;
  const pixels = Math.hypot(span * camera.rect.w, (points[1].y - points[0].y) * camera.rect.h);
  const width = clamp((profile?.measures?.shoulder?.value ?? 419) * .001, .29, .59);
  const worldShoulders = indices.map(([s]) => world?.[s]);
  const worldValid = poseStable && worldShoulders.every(finite);
  const modelSpan = worldValid ? Math.hypot(worldShoulders[1].x - worldShoulders[0].x, worldShoulders[1].y - worldShoulders[0].y) : width;
  const poseYaw = worldValid ? Math.atan2(worldShoulders[0].z - worldShoulders[1].z, Math.max(.085, modelSpan)) : null;
  const imageYaw = Math.atan2((points[0].z - points[1].z) * .82, span);
  const yawGuess = clamp(poseYaw == null ? imageYaw : mix(imageYaw, poseYaw, .63), -.94, .94);
  const depth = clamp(camera.focal * width * Math.cos(yawGuess) / pixels, .24, 7.5);
  const endDepth = width * Math.sin(yawGuess) * .5;
  const shoulder = [camera.ray(points[0], Math.max(.15, depth + endDepth)), camera.ray(points[1], Math.max(.15, depth - endDepth))];
  const origin = center(...shoulder);
  const scale = worldValid ? clamp(width / Math.max(.18, Math.hypot(modelSpan, worldShoulders[0].z - worldShoulders[1].z)), .61, 1.47) : 1;
  const worldZ = worldValid ? (worldShoulders[0].z + worldShoulders[1].z) * .5 : 0;
  const real = index => {
    const p = pose[index];
    const zoom = camera.rect.w * depth / camera.focal;
    const imageDepth = (p.z - meanZ) * zoom * .68;
    const modelDepth = finite(world?.[index]) && worldValid ? (world[index].z - worldZ) * scale : imageDepth;
    return camera.ray(p, clamp(depth + clamp(mix(imageDepth, modelDepth, .57), -width * 1.52, width * 1.58), .13, 8));
  };
  const hips = poseStable && indices.every(s => visible(pose[s[4]], .53) && pose[s[4]].y < .985) &&
    pose[indices[0][4]].y - points[0].y > vertical * .44 ? indices.map(s => real(s[4])) : null;
  if (mode === 'full' && !hips) return null;
  const basis = axes(shoulder, hips);
  const { q, up, forward, side } = basis;
  const inverse = q.clone().invert();
  const local = p => p.clone().sub(origin).applyQuaternion(inverse);
  const worldAt = p => p.clone().applyQuaternion(q).add(origin);
  const middle = camera.image(origin);
  const hip = hips ? local(center(...hips)) : V(0, -width * 1.09, -.024);
  const length = clamp(-hip.y, width * .79, width * 1.52);

  const shoulderProfiles = points.map(p => topOfShoulder(read, mask, p, middle.x, vertical));
  const crowns = shoulder.map((p, i) => {
    const q = local(p);
    if (shoulderProfiles[i]) q.y = clamp(local(camera.ray(shoulderProfiles[i], -p.z)).y, .012, width * .24);
    else q.y = width * .080;
    return q;
  });
  const topCount = shoulderProfiles.filter(Boolean).length;
  const facial = head && Math.abs(head.faceCenter.x - middle.x) < span * .61 &&
    head.faceCenter.y < middle.y + vertical * .12;
  const faceDepth = poseStable && visible(pose?.[0], .46, .11) ? -real(0).z : depth - width * .18;
  const averageCrown = (crowns[0].y + crowns[1].y) * .5;
  const neck = {
    center: V(0, Math.max(.016, averageCrown + .014), -.017),
    rx: width * .144, rz: width * .132,
  };
  const neckTarget = worldAt(neck.center.clone().add(V(0, .067, -.019)));
  const fittedHead = facial ? attachHead(head, neckTarget, faceDepth, width) : null;
  if (fittedHead) neck.center.x = clamp(local(fittedHead.surface[152]).x * .145, -.035, .035);
  neck.joint = fittedHead ? local(headJoint(fittedHead)) : neck.center.clone().add(V(0, .091, .004));

  const rings = [
    [.20, .433, .230], [.37, .445, .252], [.66, .389, .224], [1, .432, .235],
  ].map(([t, rx, rz]) => {
    const p = hip.clone().multiplyScalar(t);
    p.y = -length * t;
    const projected = camera.image(worldAt(p));
    const readings = [-.011, 0, .011].map(offset => traceRow(read, mask, projected.x, projected.y + offset, span * .73))
      .filter(Boolean).sort((a, b) => a.width - b.width);
    const row = readings[Math.floor(readings.length * .5)];
    let radius = width * rx;
    if (row) {
      const half = row.width * camera.rect.w * -worldAt(p).z / (2 * camera.focal * Math.max(.62, Math.abs(side.x)));
      radius = mix(radius, clamp(half, width * .33, width * .58), row.trust * .54);
      const entrance = camera.ray({x:(row.left + row.right)*.5,y:projected.y}, -worldAt(p).z);
      p.x = mix(p.x, clamp(local(entrance).x, -.080, .080), row.trust * .55);
    }
    return { t, center: p, rx: radius, rz: width * rz, trust: row?.trust ?? 0 };
  });
  const armQuality = [], occluders = [], hands = [];
  const arms = indices.map(([, e, w, h], i) => {
    const b = local(shoulder[i]);
    const direction = V(i ? .21 : -.21, -1, .06).normalize();
    const armLength = (profile?.measures?.sleeve?.value ?? 615) * .001;
    const ec = poseStable && visible(pose[e], .42, .135) ? pose[e].visibility : 0;
    const wc = poseStable && visible(pose[w], .42, .13) ? pose[w].visibility : 0;
    const certainty = c => clamp((c - .37) / .31, 0, 1);
    const elbow = b.clone().addScaledVector(direction, armLength * .525);
    if (ec) elbow.lerp(local(real(e)), certainty(ec));
    const reach = elbow.clone().sub(b).normalize().lerp(direction, .60).normalize();
    const wrist = elbow.clone().addScaledVector(reach, armLength * .475);
    if (wc && ec) wrist.lerp(local(real(w)), certainty(wc));
    armQuality.push(Math.min(ec || 0, wc || 0));
    if (wc > .54) {
      const palm = visible(pose[h], .45, .078) ? local(real(h)) : wrist.clone().addScaledVector(reach, .038);
      const front = clamp((wrist.z - width * .11) / (width * .46), 0, 1);
      hands.push({ wrist, palm, front, radius: width * .062 });
      occluders.push({ elbow: pose[e], wrist: pose[w], hand: finite(pose[h]) ? pose[h] : pose[w], radius: span * .132, front });
    }
    return [b, elbow, wrist].map(worldAt);
  });
  const leg = hips ? indices.flatMap(ids => ids.slice(4).every(i => visible(pose[i], .48, .065)) ? [ids.slice(4).map(real)] : []) : [];
  const projectedSide = camera.image(origin.clone().addScaledVector(side, width * .25));
  const collar = worldAt(neck.center.clone().add(V(0, -.012, neck.rz)));
  const quality = estimated ? .52 : clamp(.48 + (points[0].visibility + points[1].visibility) * .17 +
    topCount * .036 + (hips ? .048 : 0) + (facial ? .044 : 0), 0, 1);
  return {
    kind: estimated ? 'estimate' : 'body', camera, origin, q, shoulder, hip: hips, arms, hands, leg, head: fittedHead,
    full: leg.length === 2, depth, quality, armQuality, occluders, yaw: yawGuess, collar, span: width, screenSpan: span,
    screenCenter: middle, screenCollar: camera.image(collar), maskShift, imageRatio: aspect,
    screenSlope: (projectedSide.y - middle.y) / Math.max(.002, projectedSide.x - middle.x),
    sections: { chest: { center: worldAt(rings[1].center) }, waist: { center: worldAt(rings[2].center) },
      hip: { center: worldAt(rings[3].center) } },
    volume: { width, length, neck, rings, crowns, topCount, profile, leg: leg.map(chain => chain.map(local)) },
  };
}

export function bodyRing(volume, t) {
  const all = volume.rings;
  if (t < all[0].t) return all[0];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    if (t <= b.t) {
      const w = (t - a.t) / (b.t - a.t);
      const u = w * w * (3 - 2 * w);
      return { center: a.center.clone().lerp(b.center, u), rx: mix(a.rx, b.rx, u), rz: mix(a.rz, b.rz, u) };
    }
  }
  return all.at(-1);
}
