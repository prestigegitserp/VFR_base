export function subjectMask(mask, pose, face) {
  if (!mask) return mask;
  const { data, w, h } = mask;
  const shoulders = pose?.[11]?.visibility > .43 && pose?.[12]?.visibility > .43;
  const center = shoulders ? {
    x: (pose[11].x + pose[12].x) / 2,
    y: (pose[11].y + pose[12].y) / 2 + Math.min(.11, Math.abs(pose[11].x - pose[12].x) * .22),
  } : null;
  const head = face?.[1];
  const inTorso = !center || !head || Math.abs(head.x - center.x) < Math.abs(pose[11].x - pose[12].x) * .67;
  const seeds = [center, inTorso ? head : null, pose?.[0]?.visibility > .35 ? pose[0] : null]
    .filter(p => p && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1);
  if (!seeds.length) return mask;
  const seen = new Uint8Array(w * h);
  const queue = new Uint32Array(w * h);
  let count = 0;
  const add = at => {
    if (data[at] && !seen[at]) { seen[at] = 1; queue[count++] = at; }
  };
  for (const p of seeds) {
    const u = Math.floor(p.x * w), v = Math.floor(p.y * h);
    for (let y = Math.max(0, v - 2); y <= Math.min(h - 1, v + 2); y++) {
      for (let x = Math.max(0, u - 2); x <= Math.min(w - 1, u + 2); x++) add(y * w + x);
    }
  }
  for (let i = 0; i < count; i++) {
    const at = queue[i], x = at % w, y = Math.floor(at / w);
    if (x > 0) add(at - 1);
    if (x < w - 1) add(at + 1);
    if (y > 0) add(at - w);
    if (y < h - 1) add(at + w);
  }
  if (count < w * h * .019) return mask;
  const picked = new Uint8Array(w * h);
  for (let i = 0; i < count; i++) picked[queue[i]] = data[queue[i]];
  return { ...mask, data: picked };
}
