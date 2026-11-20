import { Triangle, Vector3 } from 'three';

function build(ids, data) {
  const bounds = new Float32Array(6);
  if (ids.length <= 8) return { bounds, ids };
  const extents = [0, 1, 2].map(axis => {
    let lo = Infinity, hi = -Infinity;
    for (const id of ids) {
      const value = data[id * 9 + axis] + data[id * 9 + axis + 3] + data[id * 9 + axis + 6];
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
    return hi - lo;
  });
  const axis = extents.indexOf(Math.max(...extents));
  const center = id => data[id * 9 + axis] + data[id * 9 + axis + 3] + data[id * 9 + axis + 6];
  ids.sort((a, b) => center(a) - center(b));
  const midpoint = ids.length >> 1;
  return { bounds, left: build(ids.slice(0, midpoint), data), right: build(ids.slice(midpoint), data) };
}

function distanceToBox(b, x, y, z) {
  const dx = Math.max(b[0] - x, x - b[3], 0);
  const dy = Math.max(b[1] - y, y - b[4], 0);
  const dz = Math.max(b[2] - z, z - b[5], 0);
  return dx * dx + dy * dy + dz * dz;
}

function refit(node, data) {
  const b = node.bounds;
  if (node.ids) {
    b.fill(Infinity, 0, 3);
    b.fill(-Infinity, 3);
    for (const id of node.ids) {
      for (let p = id * 9, end = p + 9; p < end; p += 3) {
        for (let a = 0; a < 3; a++) {
          b[a] = Math.min(b[a], data[p + a]);
          b[a + 3] = Math.max(b[a + 3], data[p + a]);
        }
      }
    }
    return b;
  }
  const l = refit(node.left, data), r = refit(node.right, data);
  for (let a = 0; a < 3; a++) {
    b[a] = Math.min(l[a], r[a]);
    b[a + 3] = Math.max(l[a + 3], r[a + 3]);
  }
  return b;
}

export class MeshContact {
  constructor(index) {
    this.index = index;
    this.data = new Float32Array(index.length * 3);
    this.normals = new Float32Array(index.length);
    this.triangle = new Triangle();
    this.normal = new Vector3();
    this.point = new Vector3();
    this.nearest = new Vector3();
    this.hit = new Vector3();
  }

  update(positions) {
    const { index, data, normals, triangle, normal } = this;
    for (let i = 0; i < index.length; i++) {
      const at = index[i] * 3, out = i * 3;
      data[out] = positions[at]; data[out + 1] = positions[at + 1]; data[out + 2] = positions[at + 2];
    }
    for (let i = 0; i < index.length; i += 3) {
      triangle.a.fromArray(data, i * 3);
      triangle.b.fromArray(data, i * 3 + 3);
      triangle.c.fromArray(data, i * 3 + 6);
      triangle.getNormal(normal).toArray(normals, i);
    }
    this.root ??= build(Array.from({ length: index.length / 3 }, (_, i) => i), data);
    refit(this.root, data);
  }

  search(node, bound) {
    if (bound > this.bestSquared) return;
    const { point, nearest, triangle, data, hit } = this;
    if (node.ids) {
      for (const id of node.ids) {
        const at = id * 9;
        triangle.a.fromArray(data, at);
        triangle.b.fromArray(data, at + 3);
        triangle.c.fromArray(data, at + 6);
        triangle.closestPointToPoint(point, nearest);
        const d = nearest.distanceToSquared(point);
        if (d < this.bestSquared) {
          this.bestSquared = d;
          this.bestId = id;
          hit.copy(nearest);
        }
      }
      return;
    }
    const { left, right } = node;
    const l = distanceToBox(left.bounds, point.x, point.y, point.z);
    const r = distanceToBox(right.bounds, point.x, point.y, point.z);
    if (l < r) { this.search(left, l); this.search(right, r); }
    else { this.search(right, r); this.search(left, l); }
  }

  distance(x, y, z, range = Infinity) {
    const { point, hit, normals, normal, root } = this;
    if (!root) return Infinity;
    point.set(x, y, z);
    this.bestSquared = range * range;
    this.bestId = -1;
    this.search(root, distanceToBox(root.bounds, x, y, z));
    if (this.bestId < 0) return Infinity;
    normal.fromArray(normals, this.bestId * 3);
    const sign = (x - hit.x) * normal.x + (y - hit.y) * normal.y + (z - hit.z) * normal.z;
    return (sign < 0 ? -1 : 1) * Math.sqrt(this.bestSquared);
  }

  project(positions, i, padding, range) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const d = this.distance(x, y, z, range);
    if (d >= padding) return 0;
    const { hit, normal } = this;
    const k = d > 1e-6 ? padding / d : 0;
    positions[i] = hit.x + (k ? (x - hit.x) * k : normal.x * padding);
    positions[i + 1] = hit.y + (k ? (y - hit.y) * k : normal.y * padding);
    positions[i + 2] = hit.z + (k ? (z - hit.z) * k : normal.z * padding);
    return padding - d;
  }
}
