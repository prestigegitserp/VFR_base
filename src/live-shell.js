import * as T from 'three';
import { clamp, fabrics } from './catalog.js';
import { bodyRing } from './body-volume.js';
import { materials } from './wear.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const tau = Math.PI * 2;
const columns = 64;
const rows = 38;
const cuffRows = 21;
const mix = (a, b, t) => a + (b - a) * t;
const ease = t => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const arc = a => Math.atan2(Math.sin(a), Math.cos(a));
const at = (r, c) => r * columns + (c + columns) % columns;
const appendQuad = (indices, a, b, c, d) => indices.push(a, b, c, c, b, d);

function armhole(c, side) {
  const left = c - 5, right = c + 5, top = 4, bottom = 13;
  const outline = [];
  for (let u = left; u < right; u++) outline.push([top, u]);
  for (let v = top; v < bottom; v++) outline.push([v, right]);
  for (let u = right; u > left; u--) outline.push([bottom, u]);
  for (let v = bottom; v > top; v--) outline.push([v, left]);
  return {
    left, right, top, bottom, side,
    vertices: outline.map(([v,u]) => ({
      at: at(v, u),
      angle: Math.atan2((v - (top + bottom) * .5) / ((bottom - top) * .5), -(u - c) / 5 * side),
    })),
  };
}

function skinGeometry(count, indices, uv) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(count * 3), 3).setUsage(T.DynamicDrawUsage));
  if (uv) geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array(uv), 2));
  geometry.setIndex(indices);
  return geometry;
}

function circleFrame(tangent, previous) {
  const front = previous.clone().addScaledVector(tangent, -previous.dot(tangent));
  if (front.lengthSq() < .0024) {
    front.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
  }
  front.normalize();
  return { front, cross: V().crossVectors(tangent, front).normalize() };
}

function distanceRows(item, length) {
  if (item.cut === 'skirt' || item.cut === 'dress') return Array.from({ length: rows + 1 }, (_, i) => i / rows * length);
  const chest = .236;
  return Array.from({ length: rows + 1 }, (_, i) => i <= 15 ? i / 15 * chest : mix(chest, length, (i - 15) / (rows - 15)));
}

function makeCord(group, material, radius, count, name) {
  const segments = 7, indices = [], uv = [];
  for (let i = 0; i < count; i++) for (let j = 0; j < segments; j++) uv.push(j / segments, i / (count - 1));
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const n = (j + 1) % segments, a = i * segments, b = (i + 1) * segments;
      appendQuad(indices, a + j, b + j, a + n, b + n);
    }
  }
  const geometry = skinGeometry(count * segments, indices, uv);
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name; mesh.frustumCulled = false; group.add(mesh);
  const positions = geometry.attributes.position;
  return points => {
    let normal = V(0, 0, 1);
    for (let i = 0; i < count; i++) {
      const direction = points[Math.min(i + 1, count - 1)].clone().sub(points[Math.max(i - 1, 0)]).normalize();
      const basis = circleFrame(direction, normal); normal = basis.front;
      for (let j = 0; j < segments; j++) {
        const angle = j / segments * tau;
        const p = points[i].clone().addScaledVector(basis.front, radius * Math.cos(angle)).addScaledVector(basis.cross, radius * Math.sin(angle));
        positions.setXYZ(i * segments + j, p.x, p.y, p.z);
      }
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  };
}

function torsoClearance(p, volume) {
  if (p.y > -.034 || p.y < -volume.length) return;
  const ring = bodyRing(volume, -p.y / volume.length);
  const dx = p.x - ring.center.x, dz = p.z - ring.center.z;
  const outside = Math.hypot(dx / ring.rx, dz / ring.rz);
  if (outside >= 1 || outside < .065) return;
  const radial = Math.min(1 / outside - 1, .42);
  p.x += dx * radial; p.z += dz * radial;
}

function nudgeLeg(p, volume) {
  for (const chain of volume.leg) {
    for (let i = 0; i < 2; i++) {
      const start = chain[i], end = chain[i + 1], axis = end.clone().sub(start);
      const t = clamp(p.clone().sub(start).dot(axis) / Math.max(.002, axis.lengthSq()), 0, 1);
      const delta = p.clone().sub(start.clone().lerp(end, t));
      const length = delta.length(), radius = volume.width * (i ? .124 : .174);
      if (length > .008 && length < radius) p.addScaledVector(delta, (radius - length) / length);
    }
  }
}

function crestAt(profile, x) {
  if (!profile?.length) return null;
  const t = Math.abs(x);
  if (t <= Math.abs(profile[0].x)) return profile[0].y;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1], b = profile[i], edge = Math.abs(b.x);
    if (t <= edge) return mix(a.y, b.y, (t - Math.abs(a.x)) / Math.max(.002, edge - Math.abs(a.x)));
  }
  return profile.at(-1).y;
}

export function makeLiveShell(item, size, color) {
  const measures = size.garment, coat = item.cut === 'coat', knit = item.cut === 'knit';
  const zipped = item.id === 'orion', tailored = coat || item.cut === 'jacket' && !zipped;
  const skirt = item.cut === 'skirt', dress = item.cut === 'dress', long = coat || skirt || dress;
  const dressCut = skirt || dress, sleeves = coat || knit || item.cut === 'jacket';
  const fabric = fabrics[item.fabric];
  const length = measures.length * .001;
  const segments = distanceRows(item, length);
  const cloth = materials(item.fabric, item.colors[color]?.value ?? item.colors[0].value);
  cloth.main.bumpScale *= 1.8;
  cloth.main.specularIntensity = item.fabric === 'satin' ? .71 : .37;
  cloth.main.vertexColors = true;
  const group = new T.Group();
  group.name = 'Conforming garment';
  const holes = sleeves ? [armhole(48, -1), armhole(16, 1)] : [];
  const offset = (rows + 1) * columns;
  let count = offset;
  const indices = [], uv = [], shade = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = c / columns * tau, d = segments[r];
      const light = 1 - .105 * Math.pow(Math.abs(Math.sin(a)), 3) * (1 - ease(d / .27));
      shade.push(light, light, light);
      uv.push(c / columns, d * 1.98);
      if (r === rows || holes.some(h => r >= h.top && r < h.bottom && c >= h.left && c < h.right)) continue;
      const opening = tailored ? .51 * (1 - d / .254) : 0;
      if (opening > .034 && Math.abs(arc((c + .5) / columns * tau)) < opening) continue;
      appendQuad(indices, at(r, c), at(r + 1, c), at(r, c + 1), at(r + 1, c + 1));
    }
  }
  for (const hole of holes) {
    hole.offset = count;
    const n = hole.vertices.length;
    for (let r = 1; r <= cuffRows; r++) {
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const before = i => r === 1 ? hole.vertices[i].at : count - n + i;
        appendQuad(indices, before(i), count + i, before(next), count + next);
        uv.push(i / n, .2 + (r / cuffRows) * .92);
        const light = .96 + .035 * Math.cos(hole.vertices[i].angle);
        shade.push(light, light, light);
      }
      count += n;
    }
  }

  const geometry = skinGeometry(count, indices, uv);
  geometry.setAttribute('color', new T.Float32BufferAttribute(shade, 3));
  const shell = new T.Mesh(geometry, cloth.main);
  shell.name = 'Joined torso and sleeve pattern';
  shell.frustumCulled = false;
  group.add(shell);
  const positions = geometry.attributes.position;
  const cords = [];
  const closed = !tailored && !dressCut;
  if (closed) cords.push({
    draw: makeCord(group, cloth.edge, knit ? .005 : .0032, 65, 'Rolled collar'),
    path: (_, sample) => Array.from({ length: 65 }, (_, i) => sample(i / 64 * tau, .003, .0019)),
  });
  if (zipped) cords.push({
    draw: makeCord(group, cloth.dark, .0029, 43, 'Recessed zipper tape'),
    path: (_, sample) => Array.from({ length: 43 }, (_, i) => sample(0, .016 + i / 42 * (length - .026), .003)),
  });
  const zipper = zipped ? new T.InstancedMesh(new T.BoxGeometry(.0034, .0028, .0020), cloth.metal, 92) : null;
  if (zipper) {
    zipper.name = 'Individual metal teeth';
    zipper.frustumCulled = false;
    zipper.instanceMatrix.setUsage(T.DynamicDrawUsage);
    group.add(zipper);
  }
  if (tailored || zipped) for (const s of [-1, 1]) {
    cords.push({
      draw: makeCord(group, cloth.lining, .0040, 18, 'Welt pocket'),
      path: (_, sample) => Array.from({ length: 18 }, (_, i) => {
        const along = i / 17;
        return sample(s * mix(.61, 1.10, along), length * mix(.737, .635, along), .004);
      }),
    });
  }
  if (tailored) for (const side of [-1, 1]) {
    const trimSize = 19, trimIndices = [];
    for (let i = 0; i < trimSize - 1; i++) appendQuad(trimIndices, i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 3);
    const trimUv = Array.from({length:trimSize},(_,i)=>[0,i/(trimSize-1),1,i/(trimSize-1)]).flat();
    const trimGeo = skinGeometry(trimSize * 2, trimIndices, trimUv);
    const lapel = new T.Mesh(trimGeo, cloth.lapel);
    lapel.name = 'Folded lapel';
    lapel.frustumCulled = false;
    group.add(lapel);
    cords.push({
      draw: makeCord(group, cloth.edge, .0022, 29, 'Lapel edge stitch'),
      path: (_, sample) => Array.from({ length: 29 }, (_, i) => {
        const d = i / 28 * .254;
        return sample(side * (.51 * (1 - d / .254) + .026), d, .0038);
      }),
    });
    cords.push({
      path: (_, sample) => Array.from({ length: trimSize }, (_, i) => {
        const t = i / (trimSize - 1), d = t * .254, a = .51 * (1 - t) + .028;
        const spread = (.48 * Math.sin(Math.PI * t) ** .75 + .045) * (t > .43 ? .88 : 1);
        return [sample(side * a, d, .0055), sample(side * (a + spread), d, .0086)];
      }),
      draw(points) {
        const attr = trimGeo.attributes.position;
        points.flat().forEach((p, i) => attr.setXYZ(i, p.x, p.y, p.z));
        attr.needsUpdate = true;
        trimGeo.computeVertexNormals();
      },
    });
  }
  if (dress) for (const s of [-1,1]) {
    cords.push({
      draw: makeCord(group, cloth.edge, .0064, 7, 'Shoulder strap'),
      path: (v, sample) => {
        const crown = v.crowns[s < 0 ? 0 : 1];
        const cap = V(crown.x * .66, crown.y + .010, .005);
        const start = sample(s * .53, .012, .005), end = sample(s * 2.60, .009, .005);
        return new T.CatmullRomCurve3([start, cap, end]).getPoints(6);
      },
    });
  }
  const buttons = [];
  if (tailored || zipped) for (const d of zipped ? [.027] : [.278, .376, .477]) {
    const m = new T.Mesh(new T.SphereGeometry(zipped ? .007 : .0085, 16, 10), zipped ? cloth.metal : cloth.dark);
    m.scale.z = .42; group.add(m);
    buttons.push({ m, d });
  }

  let motion = V(), velocity = V(), lastOrigin = null, phase = 0;
  const toothMatrix = new T.Matrix4();
  function update(volume, localArms, time, dt, breeze, origin, dynamics = true) {
    if (!volume) return;
    const width = volume.width, len = volume.length, neck = volume.neck;
    const bodyChest = volume.profile?.measures?.chest?.value ?? Math.round(width * 2320);
    const loosen = clamp(((measures.chest ?? measures.hip ?? 1150) - bodyChest) * .00014, .007, .030);
    if (dynamics) {
      const direction = lastOrigin ? lastOrigin.clone().sub(origin).multiplyScalar(.60) : V();
      velocity.addScaledVector(direction, 5.5).addScaledVector(motion, -8 * dt).multiplyScalar(Math.exp(-dt * 6.5));
      motion.addScaledVector(velocity, dt).clampScalar(-.055, .055);
      lastOrigin = origin.clone(); phase = time * .003;
    }
    const sample = (a, drop, extra = 0) => {
      const sa = Math.sin(a), ca = Math.cos(a);
      const front = Math.max(0, ca);
      const side = sa < 0 ? volume.crowns[0] : volume.crowns[1];
      const start = skirt ? len * .677 : dress ? .118 : 0;
      const below = (dressCut ? drop : drop - .054) + start;
      const band = bodyRing(volume, below / len);
      const flared = long ? Math.max(0, below - len * (coat ? .79 : .86)) : 0;
      const flutter = long ? ease(flared / .47) : 0;
      const wave = (skirt ? .016 : dress ? .010 : .005) * flutter * Math.cos(a * (skirt ? 19 : 10) + drop * 4);
      const seamRipple = .0023 * Math.sin(a * 13 + drop * 21) * ease(drop / .19) * (fabric.softness + .4);
      let x = band.center.x + sa * (band.rx + loosen + seamRipple + extra + flared * (skirt ? .31 : .21) + wave);
      let y = -below - (dressCut ? 0 : .008);
      let z = band.center.z + ca * (band.rz + loosen * .78 + extra + wave * .65 + flared * .19);
      if (!dressCut && drop < .167) {
        const t = drop / .167, blend = ease(t);
        const pad = tailored ? .014 : .0075;
        const lateral = Math.pow(Math.abs(sa), 5);
        const rise = Math.sin(Math.PI * t) * lateral;
        const collarY = neck.center.y + .004 - front ** 3 * (tailored ? .067 : zipped ? .034 : .044);
        const baseX = x;
        x = mix(neck.center.x + sa * (neck.rx + .005 + extra), x, ease(t * 1.30));
        x += (Math.sign(sa) * (Math.abs(side.x) + pad + extra) - baseX) * rise * .63;
        y = mix(collarY, y, t) + rise * (side.y * .50 + .0085);
        z = mix(neck.center.z + ca * (neck.rz + .007 + extra), z, blend);
        const ridge = volume.ridges?.[sa < 0 ? 0 : 1];
        if (ridge?.length) {
          const weight = ease((Math.abs(x) - neck.rx * 1.09) / (width * .20)) *
            ease((drop - .018) / .050) * (1 - ease((drop - .077) / .090));
          const target = crestAt(ridge, x);
          y += clamp(target - y - .002, -.019, .095) * weight;
          const outside = Math.abs(ridge.at(-1).x) - Math.abs(side.x);
          x += Math.sign(sa) * clamp(outside, 0, width * .10) * weight * Math.abs(sa) ** 2;
        }
      }
      const weight = ease((drop - .22) / Math.max(.16, length - .22));
      const wind = breeze ? flutter * .014 * Math.sin(phase * 2.2 + a * 2.5) : 0;
      x += (motion.x + wind) * weight;
      z += (motion.z + wind * .6) * weight;
      const p = V(x, y, z);
      if (long && below > len * .85 && volume.leg.length) nudgeLeg(p, volume);
      return p;
    };

    for (let r = 0; r <= rows; r++) for (let c = 0; c < columns; c++) {
      const p = sample(c / columns * tau, segments[r]);
      positions.setXYZ(at(r, c), p.x, p.y, p.z);
    }
    for (let j = 0; j < holes.length; j++) {
      const hole = holes[j], n = hole.vertices.length;
      const [shoulder, elbow, wrist] = localArms[j];
      const seam = hole.vertices.map(v => V().fromBufferAttribute(positions, v.at));
      const socket = seam.reduce((sum, p) => sum.add(p), V()).divideScalar(n);
      const forearm = wrist.clone().sub(elbow).normalize();
      const observed = shoulder.distanceTo(elbow) + wrist.distanceTo(elbow);
      const trim = clamp(((measures.sleeve ?? 620) * .001 - observed) * .24, -.033, .020);
      const end = wrist.clone().addScaledVector(forearm, trim);
      const curve = new T.CatmullRomCurve3([socket, shoulder.clone().lerp(elbow, .34), elbow, end]);
      const flex = 1 - clamp(elbow.clone().sub(shoulder).normalize().dot(forearm), -.9, 1);
      let normal = V(0, 0, 1);
      for (let r = 1; r <= cuffRows; r++) {
        const t = r / cuffRows;
        const middle = curve.getPoint(t);
        const { front, cross } = circleFrame(curve.getTangent(t), normal);
        normal = front;
        const wristRad = width * .080, armRad = width * (coat ? .160 : knit ? .133 : .147);
        const radius = mix(armRad + loosen * .34, wristRad, t ** 1.02);
        const seamWeight = ease(t / .227);
        for (let i = 0; i < n; i++) {
          const angle = hole.vertices[i].angle;
          const bend = Math.exp(-(((t - .66) * 7) ** 2));
          const fold = Math.cos(6 * angle + 25 * t) * bend * (.0045 + .006 * flex) +
            .0021 * Math.sin(angle * 13 - t * 31) * Math.sin(t * Math.PI);
          const round = front.clone().multiplyScalar(Math.cos(angle) * (radius * .88 + fold))
            .addScaledVector(cross, Math.sin(angle) * (radius + fold) * hole.side);
          const seamOffset = seam[i].clone().sub(socket);
          const point = middle.clone().add(seamOffset.lerp(round, seamWeight));
          if (t > .25) torsoClearance(point, volume);
          positions.setXYZ(hole.offset + (r - 1) * n + i, point.x, point.y, point.z);
        }
      }
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    cords.forEach(cord => cord.draw(cord.path(volume, sample)));
    buttons.forEach(({ m, d }) => m.position.copy(sample(zipped ? 0 : -.17, d, .004)));
    if (zipper) {
      for (let i = 0; i < zipper.count; i++) {
        const d = .025 + (length - .043) * i / (zipper.count - 1);
        const p = sample(i % 2 ? .009 : -.009, d, .006);
        toothMatrix.makeTranslation(p.x, p.y, p.z);
        zipper.setMatrixAt(i, toothMatrix);
      }
      zipper.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    group, shell, holes, update,
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      new Set(Object.values(cloth)).forEach(m => m.dispose());
    },
  };
}
