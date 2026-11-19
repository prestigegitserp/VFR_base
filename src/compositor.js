export function paintInput(ctx, source, rect, mirror) {
  if (!source || !rect) return;
  ctx.save();
  if (mirror) {
    ctx.translate(rect.x * 2 + rect.w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function capsule(ctx, start, end, width) {
  const [x, y] = start, [u, v] = end;
  const angle = Math.atan2(v - y, u - x);
  ctx.moveTo(x + Math.cos(angle + Math.PI / 2) * width, y + Math.sin(angle + Math.PI / 2) * width);
  ctx.arc(x, y, width, angle + Math.PI / 2, angle + Math.PI * 1.5);
  ctx.arc(u, v, width, angle - Math.PI / 2, angle + Math.PI / 2);
  ctx.closePath();
}

function foreground(ctx, studio, pose, input, rect, mirror, sleeve) {
  const [sl, sr] = pose.shoulders;
  const torsoWidth = Math.hypot(sl.x - sr.x, sl.y - sr.y);
  const radius = Math.max(4, torsoWidth / 4.16 * studio.height * .105);
  ctx.save();
  ctx.beginPath();
  let drawn = false;
  for (let i = 0; i < 2; i++) {
    if (!pose.armVisibility[i]) continue;
    const wrist = pose.wrists[i], elbow = pose.elbows[i], hand = pose.hands[i];
    if (wrist.z < torsoWidth * .16 && elbow.z < torsoWidth * .16) continue;
    const start = sleeve && wrist.z > torsoWidth * .14 ? wrist : {
      x: elbow.x + (wrist.x - elbow.x) * .31, y: elbow.y + (wrist.y - elbow.y) * .31, z: elbow.z,
    };
    const end = hand.z > torsoWidth * .1 ? hand : wrist;
    capsule(ctx, studio.location(start), studio.location(end), radius * (sleeve ? .84 : 1));
    drawn = true;
  }
  if (drawn) {
    ctx.clip();
    paintInput(ctx, input, rect, mirror);
  }
  ctx.restore();
}

function skeleton(ctx, studio, pose) {
  const sides = [0, 1];
  const chains = [[...pose.shoulders, pose.hips[1], pose.hips[0], pose.shoulders[0]]];
  for (const i of sides) {
    chains.push([pose.shoulders[i], pose.elbows[i], pose.wrists[i]]);
    chains.push([pose.hips[i], pose.knees[i], pose.ankles[i]]);
  }
  ctx.save();
  ctx.strokeStyle = '#dafb88';
  ctx.fillStyle = '#e5ffa5';
  ctx.lineWidth = 1.45;
  for (const chain of chains) {
    const positions = chain.map((p) => studio.location(p));
    ctx.beginPath();
    ctx.moveTo(...positions[0]);
    positions.slice(1).forEach((point) => ctx.lineTo(...point));
    ctx.stroke();
    for (const [x, y] of positions) {
      ctx.beginPath();
      ctx.arc(x, y, 2.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function composite(ctx, studio, { showSkeleton, occlusion, input, rect, mirror, sleeve }) {
  const { width, height, pose } = studio;
  const canvas = ctx.canvas;
  if (canvas.width !== Math.round(width * devicePixelRatio) || canvas.height !== Math.round(height * devicePixelRatio)) {
    canvas.width = Math.round(width * devicePixelRatio);
    canvas.height = Math.round(height * devicePixelRatio);
  }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!pose) return;
  if (occlusion && input) foreground(ctx, studio, pose, input, rect, mirror, sleeve);
  if (showSkeleton) skeleton(ctx, studio, pose);
}
