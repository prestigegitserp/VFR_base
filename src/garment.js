import * as T from 'three';
import { catalog, cuts, fabrics, dimensions, clamp } from './catalog.js';
import { Cloth, clothRing } from './cloth.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new T.Vector3(x, y, z);
const textureCache = new Map();
const quiet = { x: 0, y: 0, z: 0, turn: 0 };

function weaveTexture(key, amount) {
  if (typeof document === 'undefined') return null;
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const pixels = ctx.createImageData(128, 128);
  let state = 97517;
  for (let y = 0; y < 128; y++) {
    for (let x = 0; x < 128; x++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = state / 4294967296 - .5;
      const direction = key === 'twill' ? x - y : x;
      const threads = Math.cos(direction * Math.PI / 2) * .3 + Math.sin(y * Math.PI / 3.2) * .26;
      const value = 128 + (noise + threads) * amount;
      const index = (y * 128 + x) * 4;
      pixels.data.set([value, value, value, 255], index);
    }
  }
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.repeat.set(9, 8);
  texture.anisotropy = 4;
  textureCache.set(key, texture);
  return texture;
}

function makeMaterials(item, color) {
  const f = fabrics[item.fabric];
  const dye = new T.Color(color);
  const fabric = new T.MeshPhysicalMaterial({
    color: dye, roughness: f.roughness, metalness: 0, sheen: f.sheen, sheenColor: dye.clone().lerp(new T.Color('#f4cdde'), .46),
    sheenRoughness: .55, side: T.DoubleSide, bumpMap: weaveTexture(item.fabric, f.scale * 19),
    bumpScale: item.fabric === 'satin' || item.fabric === 'silk' ? .011 : .032,
    specularIntensity: item.fabric === 'satin' ? .98 : .55,
  });
  const facing = fabric.clone();
  facing.color.multiplyScalar(.76);
  const binding = fabric.clone();
  binding.color.lerp(new T.Color('#a7867e'), .065);
  binding.roughness = Math.min(1, fabric.roughness + .18);
  const seam = new T.MeshStandardMaterial({ color: dye.clone().multiplyScalar(.57), roughness: .64 });
  const thread = new T.MeshStandardMaterial({ color: dye.clone().lerp(new T.Color('#cbb696'), .27), roughness: .55 });
  const metal = new T.MeshStandardMaterial({ color: '#ae9476', roughness: .27, metalness: .78 });
  const button = new T.MeshStandardMaterial({ color: '#332921', roughness: .34, metalness: .19 });
  return { fabric, facing, binding, seam, thread, metal, button };
}

function grid(columns, rows, point, wrap = true) {
  const positions = new Float32Array((columns + 1) * rows * 3);
  const uv = new Float32Array((columns + 1) * rows * 2);
  const indices = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col <= columns; col++) {
      const i = row * (columns + 1) + col;
      const at = col / columns;
      positions.set(point(at * (wrap ? TAU : 1), row / (rows - 1)), i * 3);
      uv.set([at, 1 - row / (rows - 1)], i * 2);
      if (row < rows - 1 && col < columns) indices.push(i, i + columns + 1, i + 1, i + 1, i + columns + 1, i + columns + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function mesh(parent, geometry, material, name) {
  const object = new T.Mesh(geometry, material);
  object.name = name;
  object.castShadow = object.receiveShadow = true;
  parent.add(object);
  return object;
}

function cord(parent, material, name, points, radius = .006, closed = false) {
  const path = new T.CatmullRomCurve3(points, closed);
  return mesh(parent, new T.TubeGeometry(path, Math.max(12, points.length * 2), radius, 5, closed), material, name);
}

function patch(parent, material, name, points, indices) {
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(points.flatMap(([x, y]) => [x + .5, y + 1]), 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return mesh(parent, g, material, name);
}

function button(parent, material, position, radius = .026) {
  const bead = mesh(parent, new T.CylinderGeometry(radius, radius * .96, .011, 16), material, 'Button');
  bead.rotation.x = Math.PI / 2;
  bead.position.copy(position);
  return bead;
}

export function makeGarment(item, size = 'M', colorIndex = 0) {
  const cut = cuts[item.cut];
  const ref = catalog.find((g) => g.cut === item.cut);
  const fit = dimensions(item, size);
  const defaultFit = dimensions(ref);
  const family = cut.family;
  const isDress = family === 'dress';
  const isSkirt = family === 'skirt';
  const isCoat = family === 'coat';
  const isTailored = cut.neck === 'lapel';
  const fullSkirt = isDress || isSkirt || isCoat;
  const material = makeMaterials(item, item.colors[colorIndex] ?? item.colors[0]);
  const group = new T.Group();
  group.name = item.en;
  const chest = clamp((fit.chest ?? defaultFit.waist) / (defaultFit.chest ?? defaultFit.waist), .67, 1.49);
  const waist = clamp(fit.waist / defaultFit.waist, .63, 1.54);
  const hips = clamp(fit.hips / defaultFit.hips, .68, 1.57);
  const hem = Math.round(fit.length * .0203 * 1000) / 1000;
  const waistDepth = isDress ? .205 : .245;
  const waistWidth = (isDress || isSkirt ? .294 : isTailored ? .387 : .435) * waist;
  const hipWidth = (isDress ? .398 : .455) * hips;
  const shellEnd = isDress || isCoat ? -.88 : -hem + .095;
  const collarTop = cut.neck === 'hood' ? .036 : .055;
  const neckline = (angle) => {
    const front = Math.max(0, Math.cos(angle));
    if (cut.neck === 'asymmetric') return -.12 - .24 * Math.sin(angle) + .08 * Math.cos(2 * angle) - .04 * front;
    if (cut.neck === 'slip') return -.18 - .12 * front + .05 * Math.sin(angle) ** 2;
    return collarTop - (isTailored ? .33 : .126) * front ** 4 - .014 * Math.sin(angle) ** 2;
  };
  const profile = [
    [0, (isDress ? .365 : .447) * chest, isDress ? .145 : .173],
    [.18, (isDress ? .396 : .452) * chest, (isDress ? .244 : .249) * chest],
    [.52, waistWidth, waistDepth * waist ** .65],
    [.79, (waistWidth * .55 + hipWidth * .45), (isDress ? .212 : .24) * hips ** .7],
    [1, isDress || isCoat ? hipWidth : cut.neck === 'bomber' ? .388 * hips : hipWidth, (isDress ? .238 : .246) * hips ** .7],
  ];

  const shell = (angle, t, offset = 0) => {
    const high = profile.findIndex(([v]) => t <= v + 1e-8);
    const [at, width, depth] = profile[Math.max(0, high - 1)];
    const [next, right, back] = profile[Math.max(0, high)];
    const u = next === at ? 0 : (t - at) / (next - at);
    const blend = u * u * (3 - 2 * u);
    const nx = Math.sin(angle), nz = Math.cos(angle);
    const shoulder = (neckline(angle) - collarTop) * Math.pow(1 - t, 4.3);
    const gathering = Math.sin(angle * (isDress ? 8 : 14) + t * (isDress ? 16 : 8)) * Math.sin(Math.PI * t) * (isDress ? .012 : .009);
    const fall = isDress ? .012 * Math.sin(angle * 6 + 12 * t) * Math.max(0, nz) : 0;
    return [nx * (width + (right - width) * blend + gathering + offset),
      collarTop + (shellEnd - collarTop) * t + shoulder + fall,
      nz * (depth + (back - depth) * blend + gathering * .74 + offset)];
  };
  const onShell = (angle, t, offset = .018) => V(...shell(angle, t, offset));
  const track = (from, to, start, end, n = 13) => Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return onShell(from + (to - from) * t, start + (end - start) * t);
  });
  const ring = (t, n = 56) => Array.from({ length: n }, (_, i) => onShell(i / n * TAU, t, .009));

  if (!isSkirt) {
    mesh(group, grid(72, 34, shell), material.fabric, 'Cut and sewn body');
    cord(group, material.binding, 'Bound neckline', ring(0), isDress ? .011 : .019, true);
    for (const angle of [-1.57, 1.57, Math.PI]) {
      cord(group, material.seam, 'Princess seam', track(angle + .07, angle, .16, .985), .004);
    }
    if (item.cut === 'luna') {
      for (let i = 0; i < 5; i++) {
        cord(group, material.binding, 'Gathers at the shoulder', track(-1.55 + i * .06, .80, .12 + i * .06, .69 + i * .042), .007 - i * .0006);
      }
      const x = -.347 * chest;
      const band = [[x - .048, -.018, .132], [x + .057, .073, .112], [x + .034, .115, -.087], [x - .073, .042, -.117]];
      patch(group, material.fabric, 'Asymmetric shoulder panel', band, [0, 1, 2, 0, 2, 3]);
    }
    if (item.cut === 'viola') {
      for (const side of [-1, 1]) {
        cord(group, material.binding, 'Shoulder strap', [V(side * .306 * chest, -.206, .163), V(side * .341 * chest, .032, .103),
          V(side * .334 * chest, .063, -.009), V(side * .293 * chest, -.189, -.13)], .013);
      }
    }
    if (!fullSkirt) {
      cord(group, material.binding, 'Hem binding', ring(.978), cut.neck === 'bomber' || cut.neck === 'hood' ? .035 : .014, true);
    }
  }

  let cloth;
  let skirt;
  if (fullSkirt) {
    const fabric = fabrics[item.fabric];
    const top = isSkirt ? -.64 : shellEnd;
    const pattern = {
      top, width: isSkirt ? waistWidth : hipWidth,
      depth: isSkirt ? .202 * waist ** .7 : .238 * hips ** .7,
      flare: cut.flare * (.7 + .3 * hips), length: isSkirt ? hem : Math.max(.28, hem + top),
      phase: item.cut === 'luna' ? .7 : 0,
      fold: fabric.folds * (isSkirt ? .034 : isCoat ? .034 : .069), pleats: cut.pleats,
    };
    const columns = isSkirt ? 120 : 76;
    const rows = 22;
    const geometry = grid(columns, rows, (angle, u) => clothRing(angle, u, pattern));
    geometry.attributes.position.setUsage(T.DynamicDrawUsage);
    skirt = mesh(group, geometry, material.fabric, isCoat ? 'Moving coat panels' : 'Moving skirt');
    skirt.frustumCulled = false;
    cloth = new Cloth({ columns, rows, pattern, fabric, vertexPositions: geometry.attributes.position.array });
    if (isSkirt || item.cut === 'luna') {
      const at = isSkirt ? top + .022 : -.522;
      const w = isSkirt ? waistWidth + .012 : waistWidth;
      const d = isSkirt ? pattern.depth + .008 : waistDepth + .023;
      mesh(group, grid(64, 4, (a, t) => [Math.sin(a) * w, at - t * (isSkirt ? .072 : .029), Math.cos(a) * d]), material.binding, 'Waist binding');
    }
  }

  if (isTailored) {
    for (const side of [-1, 1]) {
      const a = side;
      const shape = [[.189 * a, .046, .172], [.323 * a, -.141, .220], [.126 * a, -.38, .283],
        [.168 * a, -.294, .285], [.074 * a, -.53, .268], [.019 * a, -.485, .268]]
        .map(([x, y, z]) => [x * chest, y, z * chest ** .5]);
      patch(group, material.facing, 'Faced lapel', shape, [0, 1, 3, 1, 2, 3, 0, 3, 5, 3, 4, 5]);
      cord(group, material.thread, 'Lapel topstitch', shape.slice(0, 5).map(([x, y, z]) => V(x, y, z + .006)), .004);
      const pocketT = isCoat ? .82 : .69;
      cord(group, material.facing, 'Welt pocket', track(.5 * a, .99 * a, pocketT + .03, pocketT), .018);
      cord(group, material.thread, 'Pocket topstitch', track(.47 * a, .96 * a, pocketT + .051, pocketT + .03), .004);
    }
    for (const t of [.59, .73, .87]) {
      button(group, material.button, onShell(isCoat ? -.23 : -.13, t, .018));
      if (isCoat) button(group, material.button, onShell(.28, t, .018));
    }
    cord(group, material.seam, 'Front opening', track(-.023, -.021, .45, .99), .009);
    if (item.cut !== 'iris') {
      const beltY = isCoat ? -.61 : -.62;
      const t = isCoat ? .70 : .5;
      const belt = onShell(Math.PI / 2, t, .013).x;
      const depth = onShell(0, t, .018).z;
      mesh(group, grid(64, 4, (a, u) => [Math.sin(a) * belt, beltY - u * .063, Math.cos(a) * depth]), material.facing, 'Belt');
      const buckle = [[-.075, beltY + .007], [.065, beltY + .007], [.065, beltY - .068], [-.075, beltY - .068]];
      cord(group, material.metal, 'Belt buckle', buckle.map(([x, y]) => V(x, y, depth + .021)), .011, true);
    }
  }
  if (cut.neck === 'bomber') {
    cord(group, material.seam, 'Zipper tape', track(0, 0, .03, .95), .018);
    const zipGeom = new T.BoxGeometry(.021, .009, .010);
    const teeth = new T.InstancedMesh(zipGeom, material.metal, 54);
    const matrix = new T.Matrix4();
    for (let i = 0; i < 54; i++) {
      const p = onShell(0, .04 + .89 * i / 53, .031);
      matrix.makeTranslation(i % 2 ? .003 : -.003, p.y, p.z);
      teeth.setMatrixAt(i, matrix);
    }
    teeth.name = 'Zipper teeth';
    group.add(teeth);
    for (const s of [-1, 1]) cord(group, material.binding, 'Slanted zip pocket', track(.41 * s, .88 * s, .75, .6), .016);
  }
  if (cut.neck === 'hood') {
    const profile = [V(-.27, -.045, .115), V(-.24, .131, .007), V(-.15, .24, -.105),
      V(0, .266, -.17), V(.15, .24, -.105), V(.24, .131, .007), V(.27, -.045, .115)];
    cord(group, material.facing, 'Double-layer hood', profile, .074);
    cord(group, material.binding, 'Hood opening', profile.map((p) => p.clone().add(V(0, .024, .052))), .017);
    for (const s of [-1, 1]) {
      cord(group, material.thread, 'Draw cord', [V(.12 * s, -.09, .225), V(.128 * s, -.225, .284), V(.104 * s, -.382, .291)], .010);
      button(group, material.metal, V(.104 * s, -.386, .291), .014);
      cord(group, material.facing, 'Kangaroo pocket edge', track(.46 * s, .77 * s, .74, .61), .020);
    }
    cord(group, material.seam, 'Kangaroo pocket base', track(-.52, .52, .82, .82), .007);
  }

  const sleeves = [];
  if (cut.sleeve) {
    for (const side of [-1, 1]) {
      const sleeve = mesh(group, grid(28, 21, () => [0, 0, 0]), material.fabric, 'Articulated sleeve');
      const cuff = mesh(group, grid(28, 5, () => [0, 0, 0]), material.binding, 'Cuff');
      for (const part of [sleeve, cuff]) {
        part.frustumCulled = false;
        part.geometry.attributes.position.setUsage(T.DynamicDrawUsage);
      }
      sleeves.push({ side, sleeve, cuff });
    }
  }

  const rollAxis = V(0, 0, 1);
  const pathPoint = V(0, 0, 0);
  const axis = V(0, 0, 0);
  const cross = V(0, 0, 0);
  const outward = V(0, 0, 0);
  const point = V(0, 0, 0);
  const start = V(0, 0, 0);
  const end = V(0, 0, 0);
  function sleeveSweep(object, rows, startT, endT, arm, ribbed) {
    const [shoulder, elbow, wrist] = arm;
    start.copy(shoulder).multiplyScalar(.85).add(V(0, -.027, -.005));
    end.copy(elbow).lerp(wrist, clamp((cut.sleeve - .51) / .49, .25, 1));
    const attr = object.geometry.attributes.position;
    for (let row = 0; row < rows; row++) {
      const t = startT + (endT - startT) * row / (rows - 1);
      // Quadratic interpolation through the elbow softens the sleeve at the joint.
      const inverse = 1 - t;
      pathPoint.copy(start).multiplyScalar(inverse * inverse)
        .addScaledVector(elbow, 2 * t * inverse).addScaledVector(end, t * t)
        .addScaledVector(elbow, .13 * Math.sin(Math.PI * t))
        .addScaledVector(start, -.065 * Math.sin(Math.PI * t))
        .addScaledVector(end, -.065 * Math.sin(Math.PI * t));
      axis.copy(elbow).sub(start).multiplyScalar(inverse).addScaledVector(point.copy(end).sub(elbow), t).normalize();
      cross.crossVectors(axis, rollAxis).normalize();
      if (cross.lengthSq() < .001) cross.set(1, 0, 0);
      outward.crossVectors(cross, axis).normalize();
      const bulk = cut.neck === 'bomber' || cut.neck === 'hood' ? .037 : .01;
      const r = (.158 * chest ** .5 + bulk) * (1 - .38 * t) + .016 * Math.sin(Math.PI * t) - (ribbed ? .006 : 0);
      for (let col = 0; col <= 28; col++) {
        const a = col / 28 * TAU;
        const wrinkle = Math.sin(a * 8 + 34 * t) * (.006 + .013 * Math.sin(Math.PI * t) ** 4);
        const rib = ribbed ? .003 * Math.cos(a * 28 * .5) : 0;
        point.copy(pathPoint).addScaledVector(cross, Math.sin(a) * (r + wrinkle + rib))
          .addScaledVector(outward, Math.cos(a) * (r * .88 + wrinkle + rib));
        attr.setXYZ(row * 29 + col, point.x, point.y, point.z);
      }
    }
    attr.needsUpdate = true;
    object.geometry.computeVertexNormals();
  }

  function update({ dt = 0, arms, legs = [], motion = quiet, wind = 0 }) {
    for (const { side, sleeve, cuff } of sleeves) {
      const arm = arms[side < 0 ? 0 : 1];
      sleeveSweep(sleeve, 21, 0, .969, arm, false);
      sleeveSweep(cuff, 5, .936, 1.01, arm, true);
    }
    if (cloth?.update(dt, motion, legs, wind)) {
      skirt.geometry.attributes.position.needsUpdate = true;
      skirt.geometry.computeVertexNormals();
    }
  }

  function reset() {
    cloth?.reset();
    if (skirt) {
      skirt.geometry.attributes.position.needsUpdate = true;
      skirt.geometry.computeVertexNormals();
    }
  }

  function dispose() {
    group.traverse((object) => {
      object.geometry?.dispose();
      if (object.isInstancedMesh) object.dispose();
    });
    Object.values(material).forEach((m) => m.dispose());
  }

  return { group, update, reset, dispose };
}
