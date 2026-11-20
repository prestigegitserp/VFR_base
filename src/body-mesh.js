import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Vector3 } from 'three';
import { clamp } from './catalog.js';
import { bodyRing } from './body-volume.js';
import { MeshContact } from './mesh-contact.js';

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const count = 40;
const tau = 2 * Math.PI;
const levels = [-.32, -.245, -.167, -.105, -.060, -.022, .042, .118, .201, .29, .38, .48, .59, .69, .80, .91, 1, 1.075];
const wristAt = 8;
const armRadii = [.98, 1, .98, .93, .86, .77, .69, .62, .55, .65, .32];
const legRadii = [1, .98, .86, .75, .65, .59, .60, .53, .42, .34, .37, .24];
const at = (r, c) => r * count + (c + count) % count;
const quad = (out, a, b, c, d) => out.push(a, b, c, c, b, d);
const blend = (a, b, u) => a + (b - a) * u;
const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

function socket(column, sign) {
  const top = 4, bottom = 9, left = column - 4, right = column + 4;
  const edges = [];
  for (let c = left; c < right; c++) edges.push([top, c]);
  for (let r = top; r < bottom; r++) edges.push([r, right]);
  for (let c = right; c > left; c--) edges.push([bottom, c]);
  for (let r = bottom; r > top; r--) edges.push([r, left]);
  const angles = edges.map(([r, c]) => Math.atan2(-(r - (top + bottom) / 2) * sign / 2.5, -(c - column) * sign / 4));
  const around = angles.map((a, i) => ({ a, i })).sort((a,b)=>a.a-b.a);
  return { top, bottom, left, right, rim: edges.map(([r,c]) => at(r, c)), angles, around };
}

function close(out, rim, end, top = false) {
  rim.forEach((a, i) => {
    const b = rim[(i + 1) % rim.length];
    if (top) out.push(a, b, end);
    else out.push(b, a, end);
  });
}

function buildTopology(full) {
  const arms = [socket(30, -1), socket(10, 1)], legs = [], indices = [];
  let next = count * levels.length;
  let cervicalEnd = 0;
  for (let r = 0; r < levels.length - 1; r++) {
    if (r === 3) cervicalEnd = indices.length;
    for (let c = 0; c < count; c++) {
      if (arms.some(s => s.top <= r && r < s.bottom && s.left <= c && c < s.right)) continue;
      quad(indices, at(r, c), at(r + 1, c), at(r, c + 1), at(r + 1, c + 1));
    }
  }
  function attach(s, length) {
    let rim = s.rim;
    s.start = next;
    s.faces = [];
    for (let r = 0; r < length; r++) {
      s.faces.push(indices.length);
      const size = rim.length;
      for (let i = 0; i < size; i++) {
        const after = (i + 1) % size;
        quad(indices, rim[i], next + i, rim[after], next + after);
      }
      rim = rim.map((_, i) => next + i);
      next += size;
    }
    s.end = next++;
    close(indices, rim, s.end);
    s.faces.push(indices.length);
  }
  const collar = Array.from({ length: count }, (_, i) => at(0, i));
  const neckTop = next++;
  const neckFaces = indices.slice(0, cervicalEnd);
  close(neckFaces, collar, neckTop, true);
  close(indices, collar, neckTop, true);
  arms.forEach(s => attach(s, armRadii.length));
  const pelvis = Array.from({ length: count }, (_, i) => at(levels.length - 1, i));
  let seat = null, crotch = [];
  if (full) {
    const half = count / 2;
    crotch = Array.from({ length: 5 }, () => next++);
    legs.push({ rim: [...pelvis.slice(half), pelvis[0], ...crotch] }, { rim: [...pelvis.slice(0, half + 1), ...[...crotch].reverse()] });
    legs.forEach(s => attach(s, legRadii.length));
  } else {
    seat = next++;
    close(indices, pelvis, seat);
  }
  return { arms, legs, next, neckTop, seat, crotch, indices, neckFaces };
}

function tubeAxes(direction, front) {
  const inPlane = front.clone().addScaledVector(direction, -front.dot(direction));
  if (inPlane.lengthSq() < .0002) inPlane.set(0, 1, 0).addScaledVector(direction, -direction.y);
  inPlane.normalize();
  return [inPlane, inPlane.clone().cross(direction).normalize()];
}

function limb(volume, arm, i) {
  const sign = i ? 1 : -1;
  if (arm) return arm;
  const ring = bodyRing(volume, 1);
  const origin = ring.center.clone().add(V(sign * ring.rx * .47, 0, 0));
  const shin = clamp(volume.height ? volume.height * .245 : volume.length * .95, .27, .54);
  return [origin, origin.clone().add(V(sign * .018, -shin, .013)), origin.clone().add(V(sign * .029, -shin * 2, -.028))];
}

export class BodyMesh {
  constructor(full) {
    this.full = full;
    this.topology = buildTopology(full);
    const { next, indices } = this.topology;
    this.points = new Float32Array(next * 3);
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(this.points, 3).setUsage(DynamicDrawUsage));
    this.geometry.setIndex(indices);
    this.collider = new MeshContact(this.geometry.index.array);
    this.depthSurfaces = new Map();
  }

  update(volume, arms, hands) {
    const { topology, points } = this;
    const { neck, length, width, crowns } = volume;
    const set = (i, p) => p.toArray(points, i * 3);
    const top = neck.joint.clone().lerp(neck.center, .14);
    const neckAxis = top.clone().sub(neck.center).normalize();
    const [front, side] = tubeAxes(neckAxis, V(0, 0, 1));
    side.negate();
    for (let r = 0; r < levels.length; r++) {
      const t = levels[r], ring = bodyRing(volume, Math.min(1, t));
      for (let c = 0; c < count; c++) {
        const a = c * tau / count, sa = Math.sin(a), ca = Math.cos(a);
        let p;
        if (r < 3) {
          const u = r / 2;
          const center = top.clone().lerp(neck.center, u * .84);
          p = center.addScaledVector(side, sa * neck.rx * blend(.82, .94, u))
            .addScaledVector(front, ca * neck.rz * blend(.84, 1, u));
        } else {
          const shoulder = 1 - smooth((t + .072) / .32);
          const spread = smooth((t + .110) / .100);
          const radius = blend(neck.rx * 1.16, width * .54, spread);
          const rise = (crowns[sa < 0 ? 0 : 1].y - .017) * Math.abs(sa) ** 2;
          const depth = blend(neck.rz * 1.05, ring.rz, smooth((t + .105) / .226));
          const ellipse = ca >= 0 ? (ring.front ?? 1.10) : (ring.back ?? .90);
          p = V(
            blend(ring.center.x, neck.center.x, shoulder * .60) + sa * blend(ring.rx, radius, shoulder),
            -length * t + rise * shoulder * spread,
            blend(ring.center.z, neck.center.z, shoulder * .70) + ca * blend(ring.rz * ellipse, depth, shoulder)
          );
          if (r === levels.length - 1 && !this.full) {
            p.x = blend(ring.center.x, p.x, .86);
            p.z = blend(ring.center.z, p.z, .85);
          }
        }
        set(at(r, c), p);
      }
    }
    set(topology.neckTop, top.clone().addScaledVector(neckAxis, .009));
    if (!this.full) {
      const bottom = bodyRing(volume, 1).center.clone();
      bottom.y -= length * .112;
      set(topology.seat, bottom);
    }
    this.armFrames = topology.arms.map((arm, i) => {
      const [shoulder, elbow, wrist] = arms[i];
      const hand = hands.find(h => h.side === i);
      const along = wrist.clone().sub(elbow).normalize();
      const palm = hand?.palm ?? wrist.clone().addScaledVector(along, width * .13);
      const across = hand?.radius ?? width * .054;
      const tip = palm.clone().addScaledVector(along, width * .094);
      const end = tip.clone().addScaledVector(along, width * .025);
      const upper = elbow.clone().sub(shoulder).normalize();
      const centers = [.105,.22,.37,.54,.73,.92].map(u => shoulder.clone().lerp(elbow, u))
        .concat([elbow.clone().lerp(wrist,.28),elbow.clone().lerp(wrist,.66),wrist,palm,tip]);
      const base = clamp(volume.armRadii?.[i] ?? width * .133, .031, .101);
      const radii = armRadii.map((fraction, j) => j === wristAt + 1 ? across : j === wristAt + 2 ? across * .65 : base * fraction);
      const frames = this.sweep(arm, centers, radii, arm.angles, upper, end, .85);
      const length = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
      const proximal = shoulder.distanceTo(elbow) / Math.max(.001, length);
      const knots = [.105,.22,.37,.54,.73,.92].map(t=>t*proximal)
        .concat([blend(proximal,1,.28),blend(proximal,1,.66),1]);
      return { frames, knots, shoulder, length };

    });

    if (this.full) {
      const [pelvisFront, pelvisBack] = [0, count / 2].map(c => V().fromArray(points, at(levels.length - 1, c) * 3));
      topology.crotch.forEach((id, i, a) => {
        const u = (i + 1) / (a.length + 1);
        const p = pelvisFront.clone().lerp(pelvisBack, u);
        p.y -= Math.sin(u * Math.PI) * width * .087;
        set(id, p);
      });
      topology.legs.forEach((leg, i) => {
        const [hip, knee, ankle] = limb(volume, volume.leg[i], i);
        const foot = ankle.clone().add(V(0, -.029, width * .18));
        const first = hip.clone().lerp(knee, .19);
        const centers = [first, ...[.28,.42,.58,.74,.93].map(u => hip.clone().lerp(knee, u)),
          ...[.20,.44,.67,.89].map(u => knee.clone().lerp(ankle, u)), ankle, foot];
        const sign = i ? 1 : -1;
        const angles = leg.rim.map(id => {
          const p = V().fromArray(points,id * 3).sub(hip);
          return Math.atan2(p.x, p.z);
        });
        const basis = angles.map(a => {
          const mid = sign * Math.PI / 2;
          return mid + Math.atan2(Math.sin(a-mid),Math.cos(a-mid));
        });
        // Even angular sampling at the ankle. The pelvis seam winds one turn around each thigh.
        const offset = basis[0];
        const target = basis.map((_, j) => offset + j / basis.length * tau);
        const ring = bodyRing(volume, .97);
        const radius = clamp(Math.min(ring.rx * .47, ring.rz * .72), .047, .129);
        this.sweep(leg, centers, legRadii.map(s => radius * s), target,
          knee.clone().sub(hip).normalize(), foot.clone().add(V(0, -.006, .036)), .92);
      });
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingBox();
    this.collider.update(points);
  }

  sweep(socket, centers, radii, angles, firstDirection, end, oval) {
    const { points } = this, { rim } = socket;
    const seam = rim.map(id => V().fromArray(points, id * 3));
    const middle = seam.reduce((sum, point) => sum.add(point), V()).divideScalar(rim.length);
    let front = V(0, 0, 1);
    const frames = [];
    for (let r = 0; r < centers.length; r++) {
      const center = centers[r];
      const direction = r === 0 ? firstDirection :
        centers[Math.min(r + 1, centers.length - 1)].clone().sub(centers[r - 1]).normalize();
      const basis = tubeAxes(direction, front);
      front = basis[0];
      frames.push({ center, direction });
      const weight = r === 0 ? .35 : r === 1 ? .71 : 1;
      angles.forEach((a, i) => {
        const p = center.clone().addScaledVector(front, Math.cos(a) * radii[r] * oval)
          .addScaledVector(basis[1], Math.sin(a) * radii[r]);
        const anchored = center.clone().add(seam[i].clone().sub(middle).multiplyScalar(.81));
        anchored.lerp(p, weight).toArray(points, (socket.start + r * rim.length + i) * 3);
      });
    }
    end.toArray(points, socket.end * 3);
    return frames;
  }

  sampleArm(side, t, angle, clearance) {
    const { frames, knots, shoulder, length } = this.armFrames[side];
    const { rim, around, start } = this.topology.arms[side];
    const turn = angle < around[0].a ? angle + tau : angle;
    let col = 0;
    while (col < around.length - 1 && around[col + 1].a <= turn) col++;
    const a = around[col], b = around[(col + 1) % around.length];
    const u = (turn - a.a) / ((col === around.length - 1 ? b.a + tau : b.a) - a.a);
    const q = V();
    const sample = row => V().fromArray(this.points, (start + row * rim.length + a.i) * 3)
      .lerp(q.fromArray(this.points, (start + row * rim.length + b.i) * 3), u);
    let center, point;
    if (t >= 1) {
      const frame = frames[wristAt], displacement = frame.direction.clone().multiplyScalar((t - 1) * length);
      center = frame.center.clone().add(displacement);
      point = sample(wristAt).add(displacement);
    } else if (t <= knots[0]) {
      center = shoulder.clone().lerp(frames[0].center,t/knots[0]);
      point = sample(0).add(center).sub(frames[0].center);
    } else {
      let i = 1;
      while (knots[i] < t) i++;
      const v = (t - knots[i - 1]) / (knots[i] - knots[i - 1]);
      center = frames[i-1].center.clone().lerp(frames[i].center,v);
      point = sample(i-1).lerp(sample(i),v);
    }
    return point.addScaledVector(point.clone().sub(center).normalize(), clearance);
  }

  depthSurface(bareArms, leftHand, rightHand, showLegs = false) {
    const key = [bareArms,leftHand,rightHand,showLegs].join('/');
    if (!this.depthSurfaces.has(key)) {
      const { indices, neckFaces, arms, legs } = this.topology;
      const visible = [leftHand, rightHand];
      const used = neckFaces.slice();
      arms.forEach((arm, i) => {
        if (bareArms || visible[i]) used.push(...indices.slice(arm.faces[bareArms ? 0 : wristAt + 1], arm.faces.at(-1)));
      });
      if(showLegs)legs.forEach(leg=>used.push(...indices.slice(leg.faces[0],leg.faces.at(-1))));
      const geometry = new BufferGeometry();
      geometry.setAttribute('position',this.geometry.attributes.position);
      geometry.setAttribute('normal',this.geometry.attributes.normal);
      geometry.setIndex(used);
      this.depthSurfaces.set(key,geometry);
    }
    return this.depthSurfaces.get(key);
  }

  obj() {
    const index = this.geometry.index.array;
    const used = new Uint8Array(this.points.length / 3);
    for (const id of index) used[id] = 1;
    const mapping = new Uint32Array(used.length);
    const lines = ['# VFR Atelier · estimated body, coordinates in meters', 'o VFR_Body'];
    let next = 1;
    for (let i = 0; i < used.length; i++) {
      if (!used[i]) continue;
      mapping[i] = next++;
      const j = i * 3;
      lines.push('v ' + [this.points[j], this.points[j + 1], this.points[j + 2]].map(v => v.toFixed(6)).join(' '));
    }
    for (let i = 0; i < index.length; i += 3) lines.push('f ' + [mapping[index[i]], mapping[index[i + 1]], mapping[index[i + 2]]].join(' '));
    return lines.join('\n') + '\n';
  }

  dispose() {
    this.geometry.dispose();
    for (const geometry of this.depthSurfaces.values()) geometry.dispose();
  }
}
