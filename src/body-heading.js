import { clamp } from './catalog.js';

// In a frontal camera image the wearer's right (12) is on the left of the image.
export const anatomy = [[12, 14, 16, 20, 24, 26, 28], [11, 13, 15, 19, 23, 25, 27]];
const pairs = [[12, 11, 1], [24, 23, .71]];
export const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const conf = p => p?.visibility ?? (p ? 1 : 0);
const valid = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

function axisSignals(points, type, crop) {
  const result = [];
  for (const [a,b,weight] of pairs) {
    const l = points?.[a], r = points?.[b];
    if (!valid(l) || !valid(r)) continue;
    const confidence = Math.sqrt(conf(crop?.[a] ?? l) * conf(crop?.[b] ?? r));
    if (confidence < .23) continue;
    const x = r.x - l.x, z = (r.z - l.z) * (type === 'image' ? .88 : 1);
    const extent = Math.hypot(x,z);
    if (extent < (type === 'image' ? .013 : .082)) continue;
    result.push({ a:Math.atan2(z,x), weight:weight*confidence**2*(type==='metric' ? 1 : .72), type });
  }
  return result;
}

export function bodyView(angle) {
  const a = Math.abs(wrap(angle));
  return a < .67 ? 'front' : a > 2.47 ? 'back' : 'side';
}

export function solveHeading(pose, world, face, history, time=0, expectingBack=false) {
  const suggestions = [...axisSignals(world,'metric',pose), ...axisSignals(pose,'image')];
  const previous = history?.heading;
  const elapsed = previous && time > previous.time ? clamp((time-previous.time)*.001, .016, .66) : .094;
  const prediction = previous ? previous.angle + previous.velocity * Math.min(elapsed,.15) : null;
  if (!suggestions.length) {
    if (!previous) return null;
    return { ...previous, time, angle:wrap(prediction), source:'predicted', reliability:previous.reliability*.70 };
  }
  const image = suggestions.find(p=>p.type==='image');
  const reliableFace = Boolean(face?.[33] && face?.[263] && Math.abs(face[33].x-face[263].x)>.018);
  // A brief left/right swap is common after a profile. Preserve the previous rear hypothesis
  // when landmarks abruptly label a frontal body but the detector has no face evidence.
  const fresh=previous&&time-previous.time<3600;
  const ambiguousFlip=fresh&&image&&!reliableFace&&bodyView(previous.angle)==='back'&&bodyView(image.a)==='front';
  const around = point => {
    const opposite = point.a + Math.PI;
    const ref = !ambiguousFlip&&image&&Math.abs(Math.cos(image.a))>.68&&image.weight>.32 ? image.a : prediction;
    if (ref==null || Math.abs(wrap(point.a-ref))<Math.PI*.59) return point.a;
    if (point===image && point.weight>.45 && reliableFace) return point.a;
    return opposite;
  };
  let x=0, z=0, mass=0;
  for (const vote of suggestions) {
    const a=around(vote);
    x+=Math.cos(a)*vote.weight; z+=Math.sin(a)*vote.weight; mass+=vote.weight;
  }
  const observed=Math.atan2(z,x);
  if(expectingBack&&!reliableFace&&previous&&time-previous.time<6900&&
      bodyView(previous.angle)!=='front'&&bodyView(observed)==='front'){
    return {angle:previous.angle,source:'rejected-flip',reliability:.35,time};
  }
  const agreement=Math.hypot(x,z)/Math.max(.001,mass);
  const reliability=clamp(agreement*(.38+.37*mass),0,1);
  let angle=observed, velocity=0;
  if(previous && elapsed < .62) {
    const delta=wrap(observed-previous.angle);
    const gate=clamp(.27+elapsed*5.1,.32,1.46);
    const step=clamp(delta,-gate,gate);
    const blend=clamp(.54+reliability*.41+Math.abs(step)*.23,.59,1);
    angle=wrap(previous.angle+step*blend);
    velocity=clamp(previous.velocity*.38+step*blend/elapsed*.62,-5,5);
  }
  const estimate={ angle, velocity, reliability, source:suggestions.some(p=>p.type==='metric')?'landmarks-3d':'landmarks-2d',time };
  if (history) history.heading=estimate;
  return estimate;
}

export class TurnSequence {
  constructor() { this.index=0; this.samples=[]; this.hold=0; this.last=null; }

  ingest(rig, time) {
    if (!rig || this.index>=3 || this.last===time || rig.headingReliability<.46) return;
    this.last=time;
    const a=Math.abs(wrap(rig.yaw));
    const inZone=this.index===0 ? a<.41 : this.index===1 ? a>1.13&&a<2.01 : a>2.56;
    if(!inZone){this.hold=0;return;}
    if (++this.hold<2) return;
    this.samples.push({view:['front','side','back'][this.index],degrees:Math.round(a*180/Math.PI),reliability:Math.round(rig.headingReliability*100)});
    this.hold=0;
    this.index++;
  }
}
