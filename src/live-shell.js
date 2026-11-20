import * as T from 'three';
import { clamp, fabrics, form } from './catalog.js';
import { bodyRing } from './body-volume.js';
import { materials } from './wear.js';
import { perimeter, shapeSections } from './body-shape.js';
import { DrapeSolver } from './drape-solver.js';

const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
const tau = Math.PI * 2;
const columns = 48;
const rows = 32;
const cuffRows = 16;
const mix = (a, b, t) => a + (b - a) * t;
const ease = t => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };
const arc = a => Math.atan2(Math.sin(a), Math.cos(a));
const at = (r, c) => r * columns + (c + columns) % columns;
const appendQuad = (indices, a, b, c, d) => indices.push(a, b, c, c, b, d);

function armhole(c, side) {
  const left = c - 5, right = c + 5, top = 4, bottom = 12;
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

function referenceBody(item, measures) {
  const spec = form(item.form).measure;
  const width = (measures.shoulder ? measures.shoulder - 23 : spec.shoulder) * .001;
  const length = spec.height * .248 * .001;
  const neck = { center: V(0, width * .107, -.016), rx: width * .144, rz: width * .132 };
  const crowns = [-1, 1].map(side => V(width * .5 * side, width * .087, 0));
  const rings = shapeSections(width).rings.map(r => ({ ...r, center: V(0, -length * r.t, -.012 * r.t), front: 1.09, back: .91 }));
  const arms = [-1, 1].map(side => {
    const start = V(side * width * .50, 0, 0);
    const dir = V(side * .18, -.982, .035).normalize();
    const reach = (measures.sleeve ?? spec.sleeve) * .001;
    return [start, start.clone().addScaledVector(dir, reach * .526), start.clone().addScaledVector(dir, reach)];
  });
  return { volume: { width, length, rings, neck, crowns, leg: [] }, arms };
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
  const holes = sleeves ? [armhole(columns * 3 / 4, -1), armhole(columns / 4, 1)] : [];
  const offset = (rows + 1) * columns;
  let count = offset;
  const indices = [], uv = [], shade = [], pins = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = c / columns * tau, d = segments[r];
      const light = 1 - .105 * Math.pow(Math.abs(Math.sin(a)), 3) * (1 - ease(d / .27));
      shade.push(light, light, light);
      const shoulderHold = Math.abs(Math.sin(a)) ** 1.8 * (1 - ease((d - .03) / .12));
      pins.push(skirt ? (1 - ease(d / .05)) * .96 : dress ? .80 * (1 - ease(d / .075)) : Math.max(.90 * (1 - ease(d / .064)), shoulderHold * .95));
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
        pins.push(.15 * (1 - r / cuffRows) + .69 * ease((r / cuffRows - .79) / .21));
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
  const reference = referenceBody(item, measures);
  const strainMaterial = new T.MeshStandardMaterial({ color: '#ffffff', roughness: .83, vertexColors: true, side: T.DoubleSide });
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

  const toothMatrix = new T.Matrix4();
  const metrics = skirt ? [.96, (measures.waist ?? 850) * .001, (measures.hip ?? 1100) * .001] :
    [(measures.chest ?? 1020) * .001, (measures.waist ?? 940) * .001, (measures.hip ?? measures.chest ?? 1080) * .001];
  const circumference = t => t < .69 ? mix(metrics[0], metrics[1], ease((t - .38) / .31)) :
    mix(metrics[1], metrics[2], ease((t - .69) / .31));
  function shapeTarget(volume, localArms, output, adjustment = {}, skin) {
    const width = volume.width, len = volume.length, neck = volume.neck;
    const referenceCut = volume === reference.volume;
    const bodyStart = skirt ? len * .685 : dress ? len * .264 : -.050;
    const sx = 1 + (adjustment.width ?? 0) * .01, sy = 1 + (adjustment.length ?? 0) * .01;
    const ox = (adjustment.x ?? 0) * width * .01, oy = -(adjustment.y ?? 0) * width * .01;
    const oz = (adjustment.depth ?? 0) * .001;
    const template = segments.map(drop => {
      const below = bodyStart + drop, t = below / len, band = bodyRing(volume, t);
      const desired = circumference(t) * sx;
      const ratio = desired / perimeter(band.rx, band.rz);
      const scale = referenceCut ? ratio : clamp(ratio, .80, 1.30);
      const flared = long ? Math.max(0, below - len * (coat ? .81 : .88)) : 0;
      return { below, band, flared, scale };
    });
    for (let r = 0; r <= rows; r++) {
      const drop = segments[r], { below, band, flared, scale } = template[r];
      for (let c = 0; c < columns; c++) {
        const a = c / columns * tau, sa = Math.sin(a), ca = Math.cos(a), front = Math.max(0, ca);
        const shoulder = volume.crowns[sa < 0 ? 0 : 1];
        const folds = (skirt ? .013 : dress ? .0065 : .0022) * ease(flared / .43) *
          Math.cos(a * (skirt ? 16 : 9) + drop * 4);
        const easeRib = .0015 * Math.sin(a * 13 + drop * 21) * ease(drop / .19) * (fabric.softness + .4);
        const pad = referenceCut ? 0 : .0031;
        let x = band.center.x + sa * (band.rx * scale + pad + easeRib + flared * (skirt ? .34 : .20) + folds);
        let y = -bodyStart - drop * sy;
        let z = band.center.z + ca * (band.rz * (ca >= 0 ? band.front ?? 1 : band.back ?? 1) * scale +
          pad + flared * (coat ? .115 : .16) + folds * .68);
        if (!dressCut && drop < .174) {
          const u = drop / .174, spread = ease(u * 1.19);
          const lift = Math.sin(Math.PI * u) * Math.abs(sa) ** 5;
          const collar = neck.center.y + .005 - front ** 3 * (tailored ? .063 : zipped ? .029 : .039);
          const fittedSide = Math.abs(shoulder.x) + (tailored ? .012 : .008) +
            clamp(((measures.shoulder ?? width * 1000) * .001 * sx - width) * .35, -.024, .037);
          const base = x;
          x = mix(neck.center.x + sa * (neck.rx + .008), x, spread);
          x += (Math.sign(sa) * fittedSide - base) * lift * .68;
          y = mix(collar, y, u) + lift * (shoulder.y * .62 + .007);
          z = mix(neck.center.z + ca * (neck.rz + .007), z, ease(u));
          const ridge = volume.ridges?.[sa < 0 ? 0 : 1];
          if (ridge?.length) {
            const weight = ease((Math.abs(x) - neck.rx * 1.18) / (width * .22)) *
              ease((drop - .025) / .049) * (1 - ease((drop - .078) / .078));
            y += clamp(crestAt(ridge, x) - y + .0045, -.025, .068) * weight;
            const rim = Math.abs(ridge.at(-1).x) - Math.abs(shoulder.x);
            x += Math.sign(sa) * clamp(rim, 0, width * .079) * weight * Math.abs(sa) ** 2;
          }
        }
        const j = at(r, c) * 3;
        output[j] = x + ox; output[j + 1] = y + oy; output[j + 2] = z + oz;
      }
    }

    for (let j = 0; j < holes.length; j++) {
      const hole = holes[j], n = hole.vertices.length;
      const [shoulder, elbow, wrist] = localArms[j];
      const seam = hole.vertices.map(v => V().fromArray(output, v.at * 3));
      const socket = seam.reduce((sum, p) => sum.add(p), V()).divideScalar(n);
      const forearm = wrist.clone().sub(elbow).normalize();
      const observed = shoulder.distanceTo(elbow) + wrist.distanceTo(elbow);
      const trim = clamp(((measures.sleeve ?? 620) * .001 * sy - observed) * .33, -.040, .035);
      const bias = V(ox, oy, oz).multiplyScalar(.31);
      const end = wrist.clone().addScaledVector(forearm, trim).add(bias);
      const knee = elbow.clone().add(bias);
      const curve = new T.CatmullRomCurve3([socket, shoulder.clone().lerp(elbow, .33).add(bias), knee, end]);
      const flex = 1 - clamp(elbow.clone().sub(shoulder).normalize().dot(forearm), -.9, 1);
      const circumferenceScale = clamp(metrics[0] / 1.10, .79, 1.26);
      let normal = V(0, 0, 1);
      for (let r = 1; r <= cuffRows; r++) {
        const t = r / cuffRows;
        const frame = skin?.armFrame(j, t * (1 + trim / Math.max(.05,observed)));
        const plane = frame ? { front:frame.front, cross:frame.side.clone().negate() } :
          circleFrame(curve.getTangent(t), normal);
        const { front, cross } = plane;
        const middle = frame ? frame.center.clone().add(bias).lerp(socket,1-ease(t/.145)) : curve.getPoint(t);
        normal = front;
        const armRad = width * (coat ? .159 : knit ? .138 : .151) * circumferenceScale;
        const wristRad = width * .084 * circumferenceScale ** .56;
        const current = mix(armRad, wristRad, t ** 1.08);
        const radius = frame ? Math.max(current, frame.radius + .010 + .004*Math.max(0,circumferenceScale-1)) : current;
        const seamWeight = ease(t / (frame ? .171 : .243));
        for (let i = 0; i < n; i++) {
          const a = hole.vertices[i].angle;
          const bend = Math.exp(-(((t - .62) * 7) ** 2));
          const fold = Math.cos(6 * a + 25 * t) * bend * (.0028 + .0048 * flex) +
            .0013 * Math.sin(a * 13 - t * 31) * Math.sin(t * Math.PI);
          const radial = front.clone().multiplyScalar(Math.cos(a) * (radius * .91 + fold))
            .addScaledVector(cross, Math.sin(a) * (radius + fold) * hole.side);
          const offset = seam[i].clone().sub(socket).lerp(radial, seamWeight);
          middle.clone().add(offset).toArray(output, (hole.offset + (r - 1) * n + i) * 3);
        }
      }
    }
  }

  const rest = new Float32Array(positions.array.length);
  const targets = new Float32Array(rest.length);
  shapeTarget(reference.volume, reference.arms, rest);
  const bands = holes.flatMap(h => {
    const size = h.vertices.length;
    return [{ start: h.offset + (cuffRows - 2) * size, size, weight: .44 },
      { start: h.offset + (cuffRows - 1) * size, size, weight: .83 }];
  });
  const solver = new DrapeSolver(geometry.index.array, rest, geometry.attributes.uv.array, fabric, pins, bands);
  const neutralColors = new Float32Array(shade);
  const low = new T.Color('#2a8e88'), mid = new T.Color('#e6ad62'), high = new T.Color('#bc4153');
  let view = 'fit';
  function paint() {
    const colors = geometry.attributes.color;
    if (view === 'strain' && solver.stats) {
      const strain = solver.strain, c = new T.Color();
      for (let i = 0; i < colors.count; i++) {
        const t = clamp(strain[i] * 6.25, 0, 1);
        if (t < .5) c.copy(low).lerp(mid, t * 2);
        else c.copy(mid).lerp(high, (t - .5) * 2);
        colors.setXYZ(i, c.r, c.g, c.b);
      }
    } else colors.array.set(neutralColors);
    colors.needsUpdate = true;
  }
  function sample(a, drop, extra = 0) {
    const angle = (a / tau * columns + columns) % columns;
    const column = Math.floor(angle), u = angle - column;
    let row = 0;
    while (row < rows - 1 && segments[row + 1] < drop) row++;
    const v = clamp((drop - segments[row]) / (segments[row + 1] - segments[row]), 0, 1);
    const interp = attr => {
      const top = V().fromBufferAttribute(attr, at(row, column)).lerp(V().fromBufferAttribute(attr, at(row, column + 1)), u);
      const bottom = V().fromBufferAttribute(attr, at(row + 1, column)).lerp(V().fromBufferAttribute(attr, at(row + 1, column + 1)), u);
      return top.lerp(bottom, v);
    };
    const p = interp(positions);
    if (extra) {
      const normal = interp(geometry.attributes.normal).normalize();
      if (normal.z * Math.cos(a) + normal.x * Math.sin(a) < 0) normal.negate();
      p.addScaledVector(normal, extra);
    }
    return p;
  }
  function update(volume, localArms, time, dt, wind, origin, options = {}) {
    if (!volume) return;
    shapeTarget(volume, localArms, targets, options.adjustment, options.skin);
    const result = solver.advance(targets, dt, options.collider, { gravity: options.gravity, quick: options.quick,
      settle: options.settle, wind });
    positions.array.set(result); positions.needsUpdate = true;
    geometry.computeVertexNormals();
    solver.stretch();
    if (view === 'strain') paint();
    cords.forEach(cord => cord.draw(cord.path(volume, sample)));
    buttons.forEach(({ m, d }) => m.position.copy(sample(zipped ? 0 : -.17, d, .004)));
    if (zipper) {
      for (let i = 0; i < zipper.count; i++) {
        const d = .025 + (length - .043) * i / (zipper.count - 1);
        const p = sample(i % 2 ? .009 : -.009, d, .0059);
        toothMatrix.makeTranslation(p.x, p.y, p.z);
        zipper.setMatrixAt(i, toothMatrix);
      }
      zipper.instanceMatrix.needsUpdate = true;
    }
  }
  return {
    group, shell, holes, update, cuffRows,
    stats: () => solver.stats,
    reset: () => solver.reset(),
    view(mode) {
      if (view === mode) return;
      view = mode;
      shell.material = mode === 'strain' ? strainMaterial : cloth.main;
      paint();
    },
    dispose() {
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      new Set(Object.values(cloth)).forEach(m => m.dispose());
      strainMaterial.dispose();
    },
  };
}
