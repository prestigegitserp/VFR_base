const STEP = 1 / 75;
const TAU = Math.PI * 2;

export function clothRing(angle, t, pattern) {
  const u = Math.pow(t, .86);
  const pleat = Math.cos(pattern.pleats * angle + t * .42);
  const fold = (pleat * .8 + Math.cos(pattern.pleats * 2 * angle + .8) * .2)
    * pattern.fold * (.21 + .79 * u);
  const panels = t * t * .016 * Math.sin(3 * angle + pattern.phase);
  return [
    Math.sin(angle) * (pattern.width + (pattern.flare - pattern.width) * u + fold),
    pattern.top - pattern.length * t + panels,
    Math.cos(angle) * (pattern.depth + (pattern.flare * .64 - pattern.depth) * u + fold * .74),
  ];
}

export class Cloth {
  constructor({ columns, rows, pattern, fabric, vertexPositions }) {
    this.columns = columns;
    this.rows = rows;
    this.vertexPositions = vertexPositions;
    this.fabric = fabric;
    this.rest = new Float32Array(columns * rows * 3);
    this.points = this.rest.slice();
    this.previous = this.rest.slice();
    this.elapsed = 0;
    this.time = 0;
    const indices = [];
    const lengths = [];
    const strengths = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        this.rest.set(clothRing(col / columns * TAU, row / (rows - 1), pattern), (row * columns + col) * 3);
      }
    }
    const connect = (row, col, dr, dc, strength) => {
      if (row + dr >= rows) return;
      const a = (row * columns + col) * 3;
      const b = ((row + dr) * columns + (col + dc + columns) % columns) * 3;
      indices.push(a, b);
      strengths.push(strength);
      lengths.push(Math.hypot(this.rest[b] - this.rest[a], this.rest[b + 1] - this.rest[a + 1], this.rest[b + 2] - this.rest[a + 2]));
    };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        connect(row, col, 0, 1, .96);
        connect(row, col, 1, 0, .96);
        connect(row, col, 1, 1, .42);
        connect(row, col, 1, -1, .42);
        if (col % 2 === 0) {
          connect(row, col, 0, 2, .28);
          connect(row, col, 2, 0, .39);
        }
      }
    }
    this.indices = Uint32Array.from(indices);
    this.lengths = Float32Array.from(lengths);
    this.strengths = Float32Array.from(strengths);
    this.reset();
  }

  reset() {
    this.points.set(this.rest);
    this.previous.set(this.rest);
    this.elapsed = 0;
    this.copyToMesh();
  }

  copyToMesh() {
    const { columns, rows, points, vertexPositions } = this;
    for (let row = 0; row < rows; row++) {
      const from = row * columns * 3;
      const to = row * (columns + 1) * 3;
      vertexPositions.set(points.subarray(from, from + columns * 3), to);
      vertexPositions.set(points.subarray(from, from + 3), to + columns * 3);
    }
  }

  update(dt, motion, legs, wind) {
    this.elapsed = Math.min(this.elapsed + dt, STEP * 4);
    if (this.elapsed < STEP) return false;
    while (this.elapsed >= STEP) {
      this.elapsed -= STEP;
      this.time += STEP;
      this.integrate(motion, wind);
      for (let i = 0; i < 3; i++) this.constrain();
      this.collide(legs);
    }
    this.copyToMesh();
    return true;
  }

  integrate(motion, wind) {
    const { points, previous, rest, columns, rows, time, fabric } = this;
    for (let index = columns * 3; index < points.length; index += 3) {
      const vertex = index / 3;
      const t = Math.floor(vertex / columns) / (rows - 1);
      const angle = (vertex % columns) / columns * TAU;
      const lateral = (-motion.x * .52 + wind * (1 + Math.sin(4.7 * time + angle * 3) * .42)) * fabric.lift;
      const depth = (motion.turn * .62 * rest[index] - motion.z * .45 + wind * Math.cos(time * 3 + angle)) * fabric.lift;
      const x = points[index], y = points[index + 1], z = points[index + 2];
      points[index] += (x - previous[index]) * fabric.damping + lateral * STEP * STEP * t + (rest[index] - x) * .019;
      points[index + 1] += (y - previous[index + 1]) * fabric.damping - (2.4 + motion.y * .37) * STEP * STEP + (rest[index + 1] - y) * .014;
      points[index + 2] += (z - previous[index + 2]) * fabric.damping + depth * STEP * STEP * t + (rest[index + 2] - z) * .02;
      previous[index] = x;
      previous[index + 1] = y;
      previous[index + 2] = z;
    }
  }

  constrain() {
    const { points, indices, lengths, strengths, fabric, columns } = this;
    const pinned = columns * 3;
    for (let i = 0; i < lengths.length; i++) {
      const a = indices[i * 2], b = indices[i * 2 + 1];
      if (b < pinned && a < pinned) continue;
      const x = points[b] - points[a], y = points[b + 1] - points[a + 1], z = points[b + 2] - points[a + 2];
      const distance = Math.sqrt(x * x + y * y + z * z);
      if (distance < 1e-6) continue;
      const correction = (distance - lengths[i]) / distance * fabric.stiffness * strengths[i] * (a < pinned ? 1 : .5);
      if (a >= pinned) {
        points[a] += x * correction;
        points[a + 1] += y * correction;
        points[a + 2] += z * correction;
      }
      if (b >= pinned) {
        points[b] -= x * correction;
        points[b + 1] -= y * correction;
        points[b + 2] -= z * correction;
      }
    }
  }

  collide(legs) {
    const { points, rest, columns } = this;
    for (const [top, bottom] of legs) {
      const length = top.y - bottom.y;
      if (length < .08) continue;
      for (let i = columns * 3; i < points.length; i += 3) {
        const t = (top.y - points[i + 1]) / length;
        if (t < -.06 || t > 1.03) continue;
        const cx = top.x + (bottom.x - top.x) * t;
        const cz = top.z + (bottom.z - top.z) * t;
        const radius = .137 - .03 * t;
        const dx = points[i] - cx, dz = points[i + 2] - cz;
        const distance = Math.hypot(dx, dz);
        if (distance > .001 && distance < radius) {
          const outward = dx * rest[i] + dz * rest[i + 2];
          const sign = outward < 0 ? -1 : 1;
          points[i] = cx + sign * dx * radius / distance;
          points[i + 2] = cz + sign * dz * radius / distance;
        }
      }
    }
  }
}
