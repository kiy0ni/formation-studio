/** Two people about to cross or just crossed between the previous image and this one. */
export function crossingBetween(before: { x: number; y: number; w: number; h: number }[], now: { x: number; y: number; w: number; h: number }[]) {
  if (before.length < 2 || now.length < 2) return false;
  const center = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h, h: b.h });
  const near = (a: ReturnType<typeof center>, b: ReturnType<typeof center>) => {
    const h = (a.h + b.h) / 2 || 1e-6;
    return Math.abs(a.x - b.x) / h < 0.6 && Math.abs(a.y - b.y) / h < 0.35;
  };
  const cn = now.map(center);
  const cb = before.map(center);
  // each person now matched to the closest one before
  const match = cn.map((c) => {
    let best = -1;
    let bd = Infinity;
    cb.forEach((o, j) => {
      const d = Math.hypot(c.x - o.x, (c.y - o.y) * 0.5) / (c.h || 1e-6);
      if (d < bd) {
        bd = d;
        best = j;
      }
    });
    return bd < 1.2 ? best : -1;
  });
  for (let a = 0; a < cn.length; a++)
    for (let b = a + 1; b < cn.length; b++) {
      const ma = match[a];
      const mb = match[b];
      if (ma < 0 || mb < 0 || ma === mb) continue;
      if (near(cn[a], cn[b]) !== near(cb[ma], cb[mb])) return true;
    }
  return false;
}
