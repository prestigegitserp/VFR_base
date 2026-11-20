import { clamp } from './catalog.js';

const STEP = 1 / 75;
const distance = (points, a, b) => Math.hypot(points[a] - points[b], points[a + 1] - points[b + 1], points[a + 2] - points[b + 2]);
const edgeKey = (a, b, count) => Math.min(a, b) * count + Math.max(a, b);

function meshGraph(indices, rest, uv, fabric, pins) {
  const edges = new Map(), pairs = [], lengths = [], compliance = [], structural = [];
  const count = rest.length / 3;
  const stretch = fabric.thread === 'rib' ? 3.3 : fabric.softness > .75 ? 1.5 : .84;
  const lengthConstraint = (u, v, flexibility, fabricEdge = false) => {
    const a = u * 3, b = v * 3;
    const length = distance(rest, a, b);
    if (length < .00035) return;
    pairs.push(a, b); lengths.push(length);
    compliance.push(flexibility / (STEP * STEP));
    structural.push(fabricEdge ? 1 : 0);
  };
  for (let i = 0; i < indices.length; i += 3) {
    for (let edge = 0; edge < 3; edge++) {
      const a = indices[i + edge], b = indices[i + (edge + 1) % 3], across = indices[i + (edge + 2) % 3];
      const key = edgeKey(a, b, count), previous = edges.get(key);
      const du = Math.abs((uv?.[a * 2] ?? 0) - (uv?.[b * 2] ?? 0));
      const dv = Math.abs((uv?.[a * 2 + 1] ?? 0) - (uv?.[b * 2 + 1] ?? 0));
      if (previous == null) {
        const crossThread = Math.min(du, Math.abs(1 - du));
        const weave = crossThread > dv * 1.6 ? 1.45 : dv > crossThread * 1.6 ? .83 : 2.1;
        lengthConstraint(a, b, stretch * weave * 1.8e-6, true);
        edges.set(key, across);
      } else if (previous !== across && !edges.has(edgeKey(previous, across, count))) {
        // Opposite vertices of adjacent triangles form a compliant bending constraint.
        lengthConstraint(previous, across, (1.8 + fabric.softness * 3.4) * 1e-4);
      }
    }
  }
  const mass = new Float32Array(count);
  for (const id of indices) mass[id] = 1 - (pins?.[id] ?? 0) * .94;
  return { pairs: Int32Array.from(pairs), lengths: Float32Array.from(lengths),
    compliance: Float32Array.from(compliance), structural: Uint8Array.from(structural), mass };
}

export class DrapeSolver {
  constructor(indices, rest, uv, fabric, pins, bands = [], limits) {
    this.graph = meshGraph(indices, rest, uv, fabric, pins);
    this.pos = new Float32Array(rest.length);
    this.previous = new Float32Array(rest.length);
    this.oldTarget = new Float32Array(rest.length);
    this.lambda = new Float32Array(this.graph.lengths.length);
    this.strain = new Float32Array(rest.length / 3);
    this.material = fabric;
    this.pins = pins;
    this.bands = bands;
    this.indices = indices;
    this.limits = limits;
    this.shift = new Float32Array(rest.length);
    this.uses = new Float32Array(rest.length / 3);
    this.probe = new Float32Array(3);
    this.padding = .004 + fabric.thickness * .70;
    this.clock = 0;
    this.vertices = this.graph.mass.reduce((sum, x) => sum + (x > 0), 0);
    this.reset();
  }

  reset() {
    this.started = false;
    this.elapsed = 0;
    this.stats = null;
  }

  advance(target, dt, collider, { wind = false, gravity = [0, -1, 0], quick = false, settle = false } = {}) {
    const { pos, previous, oldTarget, graph } = this;
    const first = !this.started;
    if (first) {
      pos.set(target); previous.set(target); this.started = true;
    } else {
      // Carry deformation into the moving pose without adding the tracking displacement to cloth velocity.
      for (let i = 0; i < pos.length; i++) {
        const movement = target[i] - oldTarget[i];
        pos[i] += movement; previous[i] += movement;
      }
    }
    oldTarget.set(target);

    let contacts = 0, correction = 0;
    const resolve = (friction, broad) => {
      if (!collider) return;
      const range = broad ? .145 : .065;
      for (let i = 0; i < graph.mass.length; i++) {
        if (graph.mass[i] === 0) continue;
        const offset = i * 3;
        const push = collider.project(pos, offset, this.padding, range);
        if (!push) continue;
        contacts++;
        correction = Math.max(correction, push);
        if (!friction) continue;
        // Contact dissipates tangential velocity; the positional offset is not a rebound impulse.
        for (let a = 0; a < 3; a++) {
          const j = offset + a;
          previous[j] = pos[j] - clamp(pos[j] - previous[j], -.013, .013) * .29;
        }
      }
    };
    if (first) resolve(true, true);
    this.elapsed = Math.min(this.elapsed + Math.max(0, dt), STEP * 3);
    const available = Math.floor(this.elapsed / STEP);
    const steps = first || settle ? (quick ? 2 : 4) : Math.min(available, quick ? 1 : 2);
    this.elapsed = Math.max(0, this.elapsed - steps * STEP);

    for (let step = 0; step < steps; step++) {
      this.clock += STEP;
      this.integrate(target, wind, gravity);
      this.lambda.fill(0);
      const sweeps = quick ? 4 : 6;
      for (let pass = 0; pass < sweeps; pass++) {
        this.constrain(pass % 2 === 1);
        this.attachBands(target);
        if (pass === 2) {
          this.limitOffset(target);
          resolve(false, false);
        }
      }
      resolve(true, first && step === 0);
    }
    this.limitOffset(target);
    if (collider) {
      const surface = this.contactFaces(collider, quick ? 1 : 2);
      contacts += surface;
      resolve(true, false);
    }
    this.stats = { contacts, maxCorrection: correction, vertices: this.vertices };
    return pos;
  }

  integrate(target, wind, gravity) {
    const { pos, previous, material, pins, graph, clock } = this;
    const dt2 = STEP * STEP, stiffness = .053 - material.softness * .027;
    for (let i = 0; i < graph.mass.length; i++) {
      const a = i * 3, pin = pins?.[i] ?? 0, mass = graph.mass[i];
      if (mass === 0) continue;
      const flutter = wind ? Math.sin(clock * 6.4 + target[a + 1] * 8 + target[a + 2] * 16) * 1.8 : 0;
      for (let k = 0; k < 3; k++) {
        const at = a + k, point = pos[at], goal = target[at];
        const pull = stiffness + pin * .52 + clamp(Math.abs(point - goal) * 1.9, 0, .27);
        const force = gravity[k] * 5.2 + (k === 0 ? flutter * .64 : k === 2 ? flutter : 0);
        pos[at] += clamp(point - previous[at], -.030, .030) * (.89 - pin * .22) +
          (goal - point) * pull + force * dt2 * mass;
        previous[at] = point;
      }
    }
  }

  limitOffset(target) {
    if (!this.limits) return;
    const { pos, previous, limits } = this;
    for (let n = 0; n < limits.length; n++) {
      const i = n * 3;
      const x = pos[i] - target[i], y = pos[i + 1] - target[i + 1], z = pos[i + 2] - target[i + 2];
      const d = Math.hypot(x, y, z);
      if (d <= limits[n]) continue;
      const step = limits[n] / d - 1;
      pos[i] += x * step; pos[i + 1] += y * step; pos[i + 2] += z * step;
      previous[i] += x * step; previous[i + 1] += y * step; previous[i + 2] += z * step;
    }
  }

  contactFaces(collider, passes) {
    const { indices, pos, shift, uses, probe } = this;
    const padding = this.padding * .73;
    let total = 0;
    for (let k = 0; k < passes; k++) {
      shift.fill(0); uses.fill(0);
      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i]*3, b = indices[i+1]*3, c = indices[i+2]*3;
        const x = (pos[a]+pos[b]+pos[c]) / 3, y = (pos[a+1]+pos[b+1]+pos[c+1]) / 3;
        const z = (pos[a+2]+pos[b+2]+pos[c+2]) / 3;
        probe[0]=x; probe[1]=y; probe[2]=z;
        const correction = collider.project(probe,0,padding,.057);
        if (correction < .0025) continue;
        const strength = Math.min(1, .024 / correction);
        const dx = (probe[0]-x)*strength, dy = (probe[1]-y)*strength, dz = (probe[2]-z)*strength;
        shift[a]+=dx; shift[b]+=dx; shift[c]+=dx;
        shift[a+1]+=dy; shift[b+1]+=dy; shift[c+1]+=dy;
        shift[a+2]+=dz; shift[b+2]+=dz; shift[c+2]+=dz;
        uses[a/3]++; uses[b/3]++; uses[c/3]++;
        total++;
      }
      for (let i = 0; i < uses.length; i++) {
        if (!uses[i]) continue;
        const base = i*3, blend = .83/uses[i];
        for(let j=base;j<base+3;j++){
          const delta = shift[j]*blend;
          pos[j]+=delta;
          this.previous[j]+=delta;
        }
      }
    }
    return total;
  }

  attachBands(target) {
    const p = this.pos;
    for (const { start, size, weight } of this.bands) {
      const first = start * 3, end = (start + size) * 3;
      let x = 0, y = 0, z = 0;
      for (let i = first; i < end; i += 3) {
        x += target[i] - p[i]; y += target[i + 1] - p[i + 1]; z += target[i + 2] - p[i + 2];
      }
      const step = weight / size;
      for (let i = first; i < end; i += 3) {
        p[i] += x * step; p[i + 1] += y * step; p[i + 2] += z * step;
      }
    }
  }

  constrain(reverse) {
    const { pos, graph, lambda } = this;
    const { pairs, lengths, compliance, mass } = graph;
    const end = lengths.length, direction = reverse ? -1 : 1;
    for (let n = reverse ? end - 1 : 0; n >= 0 && n < end; n += direction) {
      const a = pairs[n * 2], b = pairs[n * 2 + 1];
      const dx = pos[a] - pos[b], dy = pos[a + 1] - pos[b + 1], dz = pos[a + 2] - pos[b + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < .00002) continue;
      const wa = mass[a / 3], wb = mass[b / 3], alpha = compliance[n];
      const impulse = (lengths[n] - d - alpha * lambda[n]) / (wa + wb + alpha);
      lambda[n] += impulse;
      const k = impulse / d;
      pos[a] += dx * k * wa; pos[a + 1] += dy * k * wa; pos[a + 2] += dz * k * wa;
      pos[b] -= dx * k * wb; pos[b + 1] -= dy * k * wb; pos[b + 2] -= dz * k * wb;
    }
  }

  stretch() {
    const { pairs, lengths, structural } = this.graph;
    const out = this.strain, p = this.pos;
    out.fill(0);
    let max = 0, sum = 0, count = 0;
    for (let i = 0; i < lengths.length; i++) {
      if (!structural[i] || lengths[i] < .004) continue;
      const a = pairs[i * 2], b = pairs[i * 2 + 1];
      const strain = Math.max(0, distance(p, a, b) / lengths[i] - 1);
      out[a / 3] = Math.max(out[a / 3], strain);
      out[b / 3] = Math.max(out[b / 3], strain);
      max = Math.max(max, strain);
      sum += strain; count++;
    }
    this.stats.stretch = count ? sum / count : 0;
    this.stats.peakStretch = max;
    return out;
  }
}
