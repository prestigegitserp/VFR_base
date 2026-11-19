const STEP = 1 / 90;

export class Cloth {
  constructor(columns, rows, rest, softness) {
    this.columns = columns;
    this.rows = rows;
    this.rest = rest;
    this.softness = softness;
    this.pos = rest.slice();
    this.prev = rest.slice();
    this.frames = 0;
    this.elapsed = 0;
    const edges = [], deltas = [], compliance = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      for (const [dr, dc, stretch] of [[0, 1, .14], [1, 0, .12], [1, 1, 1.4], [1, -1, 1.4], [2, 0, 4.5], [0, 2, 4.5]]) {
        if (r + dr >= rows || (stretch > 4 && c % 2)) continue;
        const a = (r * columns + c) * 3;
        const b = ((r + dr) * columns + (c + dc + columns) % columns) * 3;
        edges.push(a, b);
        deltas.push(Math.hypot(rest[a] - rest[b], rest[a + 1] - rest[b + 1], rest[a + 2] - rest[b + 2]));
        compliance.push(stretch * (.10 + softness * .48));
      }
    }
    this.edges = Uint32Array.from(edges);
    this.lengths = Float32Array.from(deltas);
    this.compliance = Float32Array.from(compliance);
    this.lambda = new Float32Array(this.lengths.length);
  }
  reset() {
    this.pos.set(this.rest);
    this.prev.set(this.rest);
    this.elapsed = 0;
  }
  advance(dt, drive, legs = []) {
    this.elapsed = Math.min(this.elapsed + dt, STEP * 4);
    if (this.elapsed < STEP) return false;
    while (this.elapsed >= STEP) {
      this.elapsed -= STEP;
      this.time = (this.time ?? 0) + STEP;
      this.integrate(drive);
      this.lambda.fill(0);
      for (let i = 0; i < 4; i++) {
        this.constrain();
        if (i % 2 === 1) this.collide(legs);
      }
    }
    return true;
  }
  integrate({ x = 0, z = 0, wind = 0, turn = 0, y = 0 }) {
    const { pos, prev, rest, columns, rows, time, softness } = this;
    const damping = .90 + softness * .063;
    const drift = .024 - softness * .010;
    for (let i = columns * 3; i < pos.length; i += 3) {
      const t = Math.floor(i / (columns * 3)) / (rows - 1);
      const wave = Math.sin(time * 5.2 + i % (columns * 3) * .09);
      const ax = clampDrive(-x) * .27 + wind * (.47 + wave * .23);
      const az = clampDrive(-z) * .24 + turn * rest[i] * .8 + wind * wave * .32;
      const a = pos[i], b = pos[i + 1], c = pos[i + 2];
      pos[i] += (a - prev[i]) * damping + ax * STEP * STEP * t + (rest[i] - a) * drift;
      pos[i + 1] += (b - prev[i + 1]) * damping - (3.5 + clampDrive(y) * .23) * STEP * STEP + (rest[i + 1] - b) * .017;
      pos[i + 2] += (c - prev[i + 2]) * damping + az * STEP * STEP * t + (rest[i + 2] - c) * drift;
      prev[i] = a; prev[i + 1] = b; prev[i + 2] = c;
    }
  }
  constrain() {
    const { pos, edges, lengths, compliance, lambda, columns } = this;
    const locked = columns * 3;
    for (let j = 0; j < lengths.length; j++) {
      const a = edges[2 * j], b = edges[2 * j + 1];
      const wa = a < locked ? 0 : 1, wb = b < locked ? 0 : 1;
      if (!wa && !wb) continue;
      const x = pos[a] - pos[b], y = pos[a + 1] - pos[b + 1], z = pos[a + 2] - pos[b + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      if (dist < .0001) continue;
      const alpha = compliance[j];
      const dl = (lengths[j] - dist - alpha * lambda[j]) / (wa + wb + alpha);
      lambda[j] += dl;
      const dx = x / dist * dl, dy = y / dist * dl, dz = z / dist * dl;
      if (wa) { pos[a] += dx; pos[a + 1] += dy; pos[a + 2] += dz; }
      if (wb) { pos[b] -= dx; pos[b + 1] -= dy; pos[b + 2] -= dz; }
    }
  }
  collide(legs) {
    const { pos, columns } = this;
    for (const { a, b, radius } of legs) {
      if (Math.abs(b.y - a.y) < .08) continue;
      for (let i = columns * 3; i < pos.length; i += 3) {
        const t = (pos[i + 1] - a.y) / (b.y - a.y);
        if (t < 0 || t > 1) continue;
        const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        const dx = pos[i] - x, dz = pos[i + 2] - z;
        const r = radius * (1 - t * .30);
        const distance = Math.hypot(dx, dz);
        if (distance >= .0001 && distance < r) {
          pos[i] = x + dx * r / distance;
          pos[i + 2] = z + dz * r / distance;
        }
      }
    }
  }
}
const clampDrive = (v) => Math.max(-13, Math.min(13, v));
