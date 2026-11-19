import { clamp } from './catalog.js';

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const labels = { background: 0, hair: 1, skin: 2, face: 3, clothes: 4, accessory: 5 };
const distanceCache = new WeakMap();

export function drawMedia(ctx, source, rect, mirror) {
  if (!source || !rect) return;
  ctx.save();
  if (mirror) {
    ctx.translate(rect.x * 2 + rect.w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function distanceFromPerson(mask) {
  if (distanceCache.has(mask)) return distanceCache.get(mask);
  const { w, h, data } = mask;
  const out = Float32Array.from(data, c => c === labels.background ? w + h : 0);
  const diagonal = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const at = y * w + x;
      if (x > 0) out[at] = Math.min(out[at], out[at - 1] + 1);
      if (y > 0) {
        out[at] = Math.min(out[at], out[at - w] + 1);
        if (x > 0) out[at] = Math.min(out[at], out[at - w - 1] + diagonal);
        if (x < w - 1) out[at] = Math.min(out[at], out[at - w + 1] + diagonal);
      }
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const at = y * w + x;
      if (x < w - 1) out[at] = Math.min(out[at], out[at + 1] + 1);
      if (y < h - 1) {
        out[at] = Math.min(out[at], out[at + w] + 1);
        if (x > 0) out[at] = Math.min(out[at], out[at + w - 1] + diagonal);
        if (x < w - 1) out[at] = Math.min(out[at], out[at + w + 1] + diagonal);
      }
    }
  }
  distanceCache.set(mask, out);
  return out;
}

function distanceTo(x, y, a, b, aspect) {
  const ax = a.x * aspect, bx = b.x * aspect;
  const dx = bx - ax, dy = b.y - a.y;
  const t = clamp(((x - ax) * dx + (y - a.y) * dy) / Math.max(1e-6, dx * dx + dy * dy), 0, 1);
  return Math.hypot(x - ax - t * dx, y - a.y - t * dy);
}

export function buildFitMatte(mask, rig, { coverage, occlusion, cut, tailored = false }) {
  const { w, h, data } = mask;
  const body = rig.kind !== 'face';
  const collar = rig.screenCollar, ratio = rig.imageRatio;
  const span = rig.screenSpan ?? .16;
  const width = span * w, vertical = span * ratio;
  const { x: shiftX, y: shiftY } = rig.maskShift ?? { x: 0, y: 0 };
  const limits = { fitted: .030, balanced: .068, drape: .132 };
  const allowance = limits[coverage] ?? limits.balanced;
  const contour = body && coverage !== 'off' ? distanceFromPerson(mask) : null;
  const long = cut === 'coat' || cut === 'dress' || cut === 'skirt';
  const sleeved = cut === 'coat' || cut === 'jacket' || cut === 'knit';
  const alpha = new Uint8ClampedArray(w * h);
  const flare = long ? (coverage === 'fitted' ? .117 : .29) : .022;
  for (let y = 0; y < h; y++) {
    const v = (y + .5) / h + shiftY;
    const drape = collar ? smooth(vertical * .48, vertical * 1.15, v - collar.y) * flare : 0;
    const outer = Math.max(2, (allowance + drape) * width);
    const soft = Math.max(1.6, width * .026);
    for (let x = 0; x < w; x++) {
      const at = y * w + x, category = data[at];
      const u = (x + .5) / w + shiftX;
      let keep = contour && category === labels.background ? 1 - smooth(outer - soft, outer + soft, contour[at]) : 1;
      if (!occlusion || !keep) { alpha[at] = keep * 255; continue; }
      if (category === labels.hair) {
        keep *= body ? .035 : .09;
      } else if (body && category === labels.face) {
        keep = 0;
      } else if (body && category === labels.skin && cut !== 'skirt') {
        const dx = (u - collar.x) / span;
        const dy = (v - collar.y - rig.screenSlope * (u - collar.x)) / vertical;
        const depth = tailored ? .29 : cut === 'dress' ? .24 : .103;
        const edge = depth * (1 - .53 * Math.min(1, Math.abs(dx) * 3.8));
        const throat = (1 - smooth(.17, .26, Math.abs(dx))) * (1 - smooth(edge - .026, edge + .033, dy));
        keep *= 1 - throat * .97;
      }
      if (body && keep && (category === labels.skin || category === labels.accessory)) {
        for (const hand of rig.occluders) {
          const radius = hand.radius * ratio;
          if (Math.abs(v - hand.wrist.y) > .29 || Math.abs(u - hand.wrist.x) > span * .83) continue;
          const fingers = 1 - smooth(radius * .54, radius, distanceTo(u * ratio, v, hand.wrist, hand.hand, ratio));
          const forearm = sleeved || category !== labels.skin ? 0 :
            (1 - smooth(radius * .70, radius * 1.27, distanceTo(u * ratio, v, hand.elbow, hand.wrist, ratio))) * hand.front;
          const towardCamera = sleeved ? .64 + .36 * hand.front : Math.max(.57, hand.front);
          keep *= 1 - Math.max(fingers * towardCamera, forearm);
        }
      }
      alpha[at] = keep * 255;
    }
  }
  return alpha;
}

const drawChain = (ctx, points, color, width = 1.5) => {
  if (!points.length) return;
  ctx.strokeStyle = ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.stroke();
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.arc(x, y, width + 1.35, 0, 2 * Math.PI);
    ctx.fill();
  }
};

function drawDiagnostics(ctx, studio, rig) {
  const send = (points, color, width) => drawChain(ctx, points.map(p => studio.point(p)), color, width);
  ctx.save();
  if (rig.kind === 'face') send(rig.eyes, '#9be8f0');
  else {
    send(rig.shoulder, '#9be8f0', 2);
    send([rig.collar, rig.origin, ...Object.values(rig.sections).map(x => x.center)], '#ffbe85', 2);
    if (rig.hip) send(rig.hip, '#9be8f0');
    rig.arms.forEach((arm, i) => {
      ctx.setLineDash(rig.armQuality[i] < .55 ? [4, 5] : []);
      send(arm, '#a6e1a5');
    });
    ctx.setLineDash([]);
    for (const leg of rig.leg) send(leg, '#a6e1a5');
  }
  ctx.restore();
}

export class FrameCompositor {
  constructor() {
    this.mask = document.createElement('canvas');
    this.maskContext = this.mask.getContext('2d');
  }
  draw(ctx, studio, { rect, mirror, mask, rig, debug, cut, tailored, coverage, occlusion, alpha }) {
    const { width, height } = studio;
    const dpr = Math.min(studio.r.getPixelRatio(), 1.65);
    const w = Math.round(width * dpr), h = Math.round(height * dpr);
    if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
      ctx.canvas.width = w;
      ctx.canvas.height = h;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!rig || !rect || !alpha) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.drawImage(studio.canvas, 0, 0, width, height);
    ctx.globalAlpha = 1;
    if (mask && (occlusion || coverage !== 'off' && rig.kind !== 'face')) {
      if (this.rig !== rig || this.sourceMask !== mask || this.cut !== cut || this.tailored !== tailored ||
          this.coverage !== coverage || this.occlusion !== occlusion) {
        this.rig = rig; this.sourceMask = mask; this.cut = cut; this.tailored = tailored;
        this.coverage = coverage; this.occlusion = occlusion;
        if (this.mask.width !== mask.w || this.mask.height !== mask.h) {
          this.mask.width = mask.w;
          this.mask.height = mask.h;
        }
        const pixels = this.maskContext.createImageData(mask.w, mask.h);
        const matte = buildFitMatte(mask, rig, { coverage, occlusion, cut, tailored });
        for (let i = 0; i < matte.length; i++) pixels.data[i * 4 + 3] = matte[i];
        this.maskContext.putImageData(pixels, 0, 0);
      }
      const shift = rig.maskShift ?? { x: 0, y: 0 };
      ctx.globalCompositeOperation = 'destination-in';
      drawMedia(ctx, this.mask, {
        ...rect,
        x: rect.x + shift.x * rect.w * (mirror ? -1 : 1),
        y: rect.y + shift.y * rect.h,
      }, mirror);
    }
    ctx.restore();
    if (debug) drawDiagnostics(ctx, studio, rig);
  }
}
