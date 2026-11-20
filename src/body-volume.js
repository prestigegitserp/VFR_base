import * as T from 'three';
import { clamp } from './catalog.js';
import { headJoint, rescaleHead } from './camera-fit.js';
import { levels, shapeSections } from './body-shape.js';
import { anatomy, bodyView, solveHeading } from './body-heading.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const mix = (a, b, t) => a + (b - a) * t;
const center = (a, b) => a.clone().lerp(b, .5);
const finite = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const visible = (p, c = .52, margin = .05) => finite(p) && (p.visibility ?? 1) >= c &&
  p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin;

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
  if (height < .09 || chin.y > .92) return null;
  const rows = [];
  const max = Math.min(.45, height * 1.4 / aspect);
  const available = Math.min(height * .53, .984 - chin.y);
  for (const offset of [.13, .27, .42, .58, .75, .90]) {
    const y = chin.y + available * offset;
    if (y > .978) continue;
    const row = [0,-.024,.024,-.047,.047].map(dx=>traceRow(read,mask,chin.x+dx,y,max)).find(Boolean);
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

function shoulderOutline(read, mask, p, middle, vertical) {
  if (!mask) return [];
  const step = 1 / mask.h, outline = [];
  for (const distance of [.25,.41,.57,.73,.89,1.04,1.15]) {
    const x = mix(middle.x, p.x, distance);
    if (x < .025 || x > .975) continue;
    const start = Math.max(.02, p.y - vertical * .36), end = Math.min(.98, p.y + vertical * .28);
    for (let y = start; y < end; y += step) {
      if (clothed(read(x, y)) && clothed(read(x, y + 2 * step)) && clothed(read(x, y + 5 * step))) {
        outline.push({ x, y, distance });
        break;
      }
    }
  }
  return outline.length >= 3 ? outline : [];
}

function axes(side, shoulders, hips) {
  const lifted = V(0, 1, 0);
  if (hips) {
    const torso = center(...shoulders).sub(center(...hips));
    torso.z = clamp(torso.z, -.22, .22);
    lifted.lerp(torso.normalize(), .62);
  }
  const forward = V().crossVectors(side, lifted).normalize();
  const up = V().crossVectors(forward, side).normalize();
  return { side, up, forward, q:new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(side,up,forward)) };
}

function bodyDepth(points, hips, width, heading, camera, previous, head, scale) {
  const c=Math.abs(Math.cos(heading)), s=Math.abs(Math.sin(heading));
  const span=Math.abs(points[1].x-points[0].x);
  const mid=(points[0].y+points[1].y)*.5;
  const shoulder=c>.26&&span>.022 ? camera.focal*width*c/(span*camera.rect.w) : 0;
  const torsoPixels=hips ? ((hips[0].y+hips[1].y)*.5-mid)*camera.rect.h : 0;
  const torso=torsoPixels>28 ? camera.focal*scale/torsoPixels : 0;
  let depth=shoulder || torso || previous || head?.depth || 1.28;
  if (c<.69) {
    const anchor=torso || previous || head?.depth;
    if (anchor) depth=mix(depth,anchor,clamp((.72-c)*1.9,.10,1));
  }
  if (previous&&s>.58) depth=clamp(depth,previous*.80,previous*1.25);
  return clamp(depth,.23,8);
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

function trackedBone(parent, prior, image, guess, length, camera, strength) {
  // Minimize depth error on the observed camera ray, with segment length as a geometric prior.
  const ray = camera.ray(image, 1).normalize();
  const closest = ray.dot(parent);
  const miss = Math.max(0, parent.lengthSq() - closest * closest);
  const radius = Math.sqrt(Math.max(0, length * length - miss));
  const estimate = ray.dot(guess);
  const near = closest - radius, far = closest + radius;
  const target = radius ? (Math.abs(estimate - near) < Math.abs(estimate - far) ? near : far) : closest;
  const depth = clamp(mix(estimate, target, strength), .17, 9);
  const confidence = clamp(((image.visibility ?? 1) - .37) / .31, 0, 1);
  return prior.lerp(ray.multiplyScalar(depth), confidence);
}

export function solveBody(input, mode, camera, head, profile) {
  const { pose, world, face, mask, maskShift, shapeHistory, at } = input;
  const read = readMask(mask, maskShift);
  const aspect = camera.rect.w / camera.rect.h;
  const indices=anatomy;
  let points=indices.map(([s])=>pose?.[s]);
  const strong=points.map(p=>visible(p,.48,.085));
  const supported=points.map(p=>visible(p,shapeHistory?.heading?.reliability>.43?.095:.23,.16));
  const history=shapeHistory;
  const heading=solveHeading(pose,world,face,history,at);
  const partial=heading&&strong.some(Boolean)&&supported.every(Boolean);
  const poseStable=strong.every(Boolean);
  const estimated=!poseStable&&!partial;
  if (estimated) {
    if (mode!=='upper') return null;
    const recovered=seatedFallback(face,read,mask,aspect);
    if (!recovered) return null;
    points=recovered;
  }
  const yawGuess=estimated ? clamp((head?.yaw??0)*.31,-.5,.5) : heading?.angle??0;
  const halfTurn=bodyView(yawGuess);
  const recorded=profile?.measures?.shoulder?.value;
  const worldShoulders=indices.map(([s])=>world?.[s]);
  const worldValid=!estimated&&worldShoulders.every(finite);
  const estimatedMeters=worldValid ? V(worldShoulders[0].x,worldShoulders[0].y,worldShoulders[0].z)
    .distanceTo(V(worldShoulders[1].x,worldShoulders[1].y,worldShoulders[1].z)) : null;
  const observedScale=estimatedMeters>.26 && estimatedMeters<.64;
  let width=clamp(recorded ? recorded*.001 : observedScale ? mix(.419,estimatedMeters,.51) : .419,.265,.62);
  if(!recorded&&history?.width)width=mix(history.width,width,halfTurn==='side'?.09:.30);
  if(history)history.width=width;
  const calibration=shapeSections(width,profile);
  const hipPoints=estimated?null:indices.map(s=>pose?.[s[4]]);
  const hipEvidence=hipPoints?.every(p=>visible(p,.34,.10)) ? hipPoints : null;
  const stature=(profile?.measures?.height?.value??0)*.001;
  const nominal=calibration.length??(stature?stature*.247:width*1.07);
  const depth=bodyDepth(points,hipEvidence,width,yawGuess,camera,history?.depth,head,nominal);
  const span=Math.max(.035,Math.abs(points[1].x-points[0].x),width*camera.focal/(depth*camera.rect.w)*.59);
  const vertical=width*camera.focal/(depth*camera.rect.h);
  const meanZ=(points[0].z+points[1].z)*.5;
  const endDepth=width*Math.sin(yawGuess)*.5;
  const measured=points.map((p,i)=>camera.ray(p,Math.max(.15,depth+(i?1:-1)*endDepth)));
  const tilt=clamp((measured[1].y-measured[0].y)/width,-.35,.35);
  const side=V(Math.cos(yawGuess),tilt,-Math.sin(yawGuess)).normalize();
  const proposals=measured.map((p,i)=>p.clone().addScaledVector(side,(i?-.5:.5)*width));
  const likelihood=strong[0]===strong[1] ? .5 : strong[0] ? .15 : .85;
  const origin=proposals[0].lerp(proposals[1],likelihood);
  const shoulder=[origin.clone().addScaledVector(side,-width*.5),origin.clone().addScaledVector(side,width*.5)];
  const err=points.reduce((n,p,i)=>{
    const a=camera.screen(shoulder[i]),b=camera.pixel(p);
    return n+(strong[i]?Math.hypot(a.x-b.x,a.y-b.y)*.5:0);
  },0);
  if(history)history.depth=depth;
  const metricScale=worldValid?clamp(width/Math.max(.18,estimatedMeters),.61,1.47):1;
  const worldZ=worldValid?(worldShoulders[0].z+worldShoulders[1].z)*.5:0;
  const real=index=>{
    const p=pose[index];
    const zoom=camera.rect.w*depth/camera.focal;
    const imageDepth=(p.z-meanZ)*zoom*.68;
    const modelDepth=finite(world?.[index])&&worldValid?(world[index].z-worldZ)*metricScale:imageDepth;
    return camera.ray(p,clamp(depth+clamp(mix(imageDepth,modelDepth,.58),-width*1.50,width*1.63),.14,8.5));
  };
  let hips=hipEvidence&&((hipEvidence[0].y+hipEvidence[1].y-points[0].y-points[1].y)*.5>vertical*.41)
    ? indices.map(s=>real(s[4])) : null;
  if(mode==='full'&&!hips) {
    if(!partial||!history?.hip) return null;
    const offset=V(0,-nominal,0);
    hips=shoulder.map(p=>p.clone().add(offset));
  }
  if(hips&&history)history.hip=true;
  const basis=axes(side,shoulder,hips);
  const { q, forward } = basis;
  const inverse = q.clone().invert();
  const local = p => p.clone().sub(origin).applyQuaternion(inverse);
  const worldAt = p => p.clone().applyQuaternion(q).add(origin);
  const middle = camera.image(origin);
  const hip = hips ? local(center(...hips)) : V(0, -width * 1.09, -.024);
  const length = clamp(hips ? -hip.y : calibration.length ?? -hip.y, width * .74, width * 1.61);

  const shoulderProfiles=points.map((p,i)=>(estimated||strong[i])&&halfTurn!=='side' ? topOfShoulder(read,mask,p,middle.x,vertical) : null);
  const crowns = shoulder.map((p, i) => {
    const q = local(p);
    if (shoulderProfiles[i]) q.y = clamp(local(camera.ray(shoulderProfiles[i], -p.z)).y, .012, width * .24);
    else q.y = width * .080;
    return q;
  });
  const topCount = shoulderProfiles.filter(Boolean).length;
  const ridges = points.map((p, i) => mode==='upper'&&halfTurn==='front' ? shoulderOutline(read,mask,p,middle,vertical).map(u => {
    const onSurface = local(camera.ray(u, mix(depth, -shoulder[i].z, clamp(u.distance, 0, 1))));
    onSurface.y = clamp(onSurface.y, -.081, width * .31);
    return onSurface;
  }) : []);
  const facial = head && halfTurn!=='back' && Math.abs(head.faceCenter.x - middle.x) < span * .75 &&
    head.faceCenter.y < middle.y + vertical * .12;
  const faceDepth = !estimated && visible(pose?.[0], .46, .11) ? -real(0).z : depth - width * .18;
  const averageCrown = (crowns[0].y + crowns[1].y) * .5;
  const neck = {
    center: V(0, Math.max(.016, averageCrown + .014), -.017),
    rx: width * .144, rz: width * .132,
  };
  const neckTarget = worldAt(neck.center.clone().add(V(0, .067, -.019)));
  const fittedHead = facial ? attachHead(head, neckTarget, faceDepth, width) : null;
  if (fittedHead) neck.center.x = clamp(local(fittedHead.surface[152]).x * .145, -.035, .035);
  neck.joint = fittedHead ? local(headJoint(fittedHead)) : neck.center.clone().add(V(0, .091, .004));

  const observations = levels.map(t => {
    const p = hip.clone().multiplyScalar(t);
    p.y = -length * t;
    const location = worldAt(p), projected = camera.image(location);
    const readings = [-.012, -.006, 0, .006, .012]
      .map(offset => traceRow(read, mask, projected.x, projected.y + offset, span * .81))
      .filter(x => x?.trust > .5).sort((a, b) => a.width - b.width);
    const row = readings[Math.floor(readings.length * .42)];
    if (!row || readings.length < 2) return { p };
    const zoom = camera.rect.w * -location.z / camera.focal;
    const yawScale = Math.hypot(side.x, side.z * .58);
    const projectedRadius=row.width*zoom*.5;
    const half = projectedRadius / Math.max(.63, yawScale);
    const radius = clamp(half, width * .28, width * .61);
    const center = local(camera.ray({x:(row.left + row.right) * .5, y:projected.y}, -location.z));
    const spread = readings.at(-1).width - readings[0].width;
    const weight = .93 * clamp(1 - 3.4 * spread / row.width, .22, 1);
    const prior=history?.rings?.[levels.indexOf(t)]??calibration.rings[levels.indexOf(t)];
    const orthogonal=Math.sin(yawGuess)**2;
    const depthReading=orthogonal>.67 ? Math.sqrt(Math.max(0,projectedRadius**2-prior.rx**2*(1-orthogonal))/orthogonal) : null;
    p.x = mix(p.x, clamp(center.x, -.066, .066), weight * .36);
    return {p,rx:radius,rz:depthReading?clamp(depthReading,width*.138,width*.372):null,weight:weight*(1-orthogonal*.86),depthWeight:weight*orthogonal};
  });
  const shape = shapeSections(width, profile, observations);
  const rings = shape.rings.map((ring, i) => {
    const old = shapeHistory?.rings?.[i];
    if (old && shape.source === 'image') {
      const w = observations[i].weight ? .22 : .046;
      ring.rx = mix(old.rx, ring.rx, w);
      const observed=observations[i];
      ring.rz=observed.rz&&heading?.reliability>.52?mix(old.rz,observed.rz,observed.depthWeight*.135):mix(old.rz,ring.rz,.012);
    }
    const t = ring.t;
    // Separate the anterior chest and posterior back instead of symmetrizing both sides.
    const chest = Math.exp(-(((t - .35) * 4.6) ** 2));
    return { ...ring, center: observations[i].p, front: 1 + chest * .14, back: 1 - chest * .14,
      trust: observations[i].weight ?? 0 };
  });
  if (shapeHistory) shapeHistory.rings = rings;
  const armRadii = [];
  const armQuality = [], occluders = [], hands = [];
  const arms = indices.map(([, e, w, h], i) => {
    const b = local(shoulder[i]);
    const direction = V(i ? .21 : -.21, -1, .06).normalize();
    const armLength = (profile?.measures?.sleeve?.value ?? 615) * .001;
    const ec = !estimated && visible(pose[e], .42, .135) ? pose[e].visibility : 0;
    const wc = !estimated && visible(pose[w], .42, .13) ? pose[w].visibility : 0;
    const upper = armLength * .525, lower = armLength * .475;
    const priorElbow = b.clone().addScaledVector(direction, upper);
    const strength = profile?.measures?.sleeve ? .72 : worldValid ? .48 : .24;
    const elbow = ec ? local(trackedBone(shoulder[i], worldAt(priorElbow), pose[e], real(e), upper, camera, strength)) : priorElbow;
    const reach = elbow.clone().sub(b).normalize().lerp(direction, .60).normalize();
    const priorWrist = elbow.clone().addScaledVector(reach, lower);
    const estimate = wc && ec ? real(w) : null;
    const raisedHand = estimate && estimate.z-origin.z > width*.26;
    const wrist = estimate ? local(trackedBone(worldAt(elbow), worldAt(priorWrist), pose[w], estimate,
      lower, camera, raisedHand ? strength * .45 : strength * .8)) : priorWrist;
    armQuality.push(Math.min(ec || 0, wc || 0));
    armRadii.push(width * clamp(.131 + (rings[3].rx / width - .445) * .17, .107, .160));
    if (wc > .54) {
      const observed = visible(pose[h], .45, .078) ? local(real(h)) : wrist.clone().addScaledVector(reach, .046);
      const direction = observed.sub(wrist).clampLength(width * .069, width * .188);
      const palm = wrist.clone().add(direction);
      const front = clamp((worldAt(wrist).z-origin.z-width*.086)/(width*.35),0,1);
      hands.push({ side:i, wrist, palm, front, radius: width * .062 });
      occluders.push({ elbow: pose[e], wrist: pose[w], hand: finite(pose[h]) ? pose[h] : pose[w], radius: span * .132, front });
    }
    return [b, elbow, wrist].map(worldAt);
  });
  const legs = hips ? indices.map((ids, i) => {
    const [, knee, ankle] = ids.slice(4);
    if (![knee, ankle].every(j => visible(pose[j], .48, .065))) return null;
    const base = hips[i], guessKnee = real(knee), guessAnkle = real(ankle);
    const stature = (profile?.measures?.height?.value ?? 0) * .001;
    const span = stature ? stature * .246 : length * .91;
    const k = trackedBone(base, guessKnee.clone(), pose[knee], guessKnee, span, camera, .48);
    const a = trackedBone(k, guessAnkle.clone(), pose[ankle], guessAnkle, span * .99, camera, .48);
    return [base, k, a];
  }) : [null, null];
  const leg = legs.filter(Boolean);
  const projectedSide = camera.image(origin.clone().addScaledVector(side, width * .25));
  const collar = worldAt(neck.center.clone().add(V(0,-.012,halfTurn==='back'?-neck.rz:neck.rz)));
  const quality = estimated ? .52 : clamp(.48 + ((points[0].visibility??1)+(points[1].visibility??1))*.17 +
    topCount * .036 + (hips ? .048 : 0) + (facial ? .044 : 0), 0, 1);
  return {
    kind: estimated ? 'estimate' : 'body', camera, origin, q, shoulder, hip: hips, arms, hands, leg, head: fittedHead,
    full: leg.length === 2, depth, quality, armQuality, occluders,yaw:yawGuess,view:halfTurn,headingReliability:estimated?.35:heading?.reliability??.43,
    headingSource:estimated?'silhouette':heading?.source,shoulderError:err,anchors:strong,collar,span:width,screenSpan:span,
    screenCenter: middle, screenCollar: camera.image(collar), maskShift, imageRatio: aspect,
    screenSlope:Math.abs(projectedSide.x-middle.x)>.004?clamp((projectedSide.y-middle.y)/(projectedSide.x-middle.x),-1,1):0,
    sections: { chest: { center: worldAt(rings[3].center) }, waist: { center: worldAt(rings[6].center) },
      hip: { center: worldAt(rings.at(-1).center) } },
    volume: { width, length, neck, rings, crowns, ridges, topCount, profile, armRadii, source: shape.source, mode,
      height: (profile?.measures?.height?.value ?? 0) * .001, leg: legs.map(chain => chain?.map(local)) },
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
      return { center: a.center.clone().lerp(b.center, u), rx: mix(a.rx, b.rx, u), rz: mix(a.rz, b.rz, u),
        front: mix(a.front ?? 1, b.front ?? 1, u), back: mix(a.back ?? 1, b.back ?? 1, u) };
    }
  }
  return all.at(-1);
}
