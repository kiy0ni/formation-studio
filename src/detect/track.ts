import type { Analysis, Det } from './analysis';
import { sigDistance } from './signature';
import { median, toFloor, type FloorModel } from './floor';

/** One person followed through the whole video (positions on the floor, meters). */
export interface Track {
  xs: Float32Array;
  ys: Float32Array;
  /** 1 where the person was really seen, 0 where the position is filled in. */
  seen: Uint8Array;
  /** Index of the person's box on each analysed image (-1 = not seen). */
  det: Int16Array;
  sig: number[];
}

export interface Tracking {
  people: number;
  suggested: number;
  tracks: Track[];
}

interface Raw {
  xs: number[];
  ys: number[];
  det: Int16Array;
  last: number;
  count: number;
  sig: number[];
  lx: number;
  ly: number;
}

/** Usual number of people in the video (most images show everyone, some hide a dancer behind another). */
export function suggestedPeople(an: Analysis) {
  const counts = an.frames.map((f) => f.filter((d) => d.s >= 0.3).length).sort((a, b) => a - b);
  return Math.max(1, counts[Math.floor((counts.length - 1) * 0.8)] ?? 1);
}

/** Follows each person from image to image: close to where they were, same clothes. */
export function trackPeople(an: Analysis, floor: FloorModel, people?: number): Tracking {
  const n = an.times.length;
  const fps = an.fps;
  const suggested = suggestedPeople(an);
  const target = Math.max(1, Math.round(people || suggested));
  const live: Raw[] = [];

  const record = (t: Raw, i: number, k: number, d: Det, x: number, y: number) => {
    t.xs[i] = x;
    t.ys[i] = y;
    t.det[i] = k;
    t.last = i;
    t.count++;
    t.lx = x;
    t.ly = y;
    if (d.s >= 0.4 && d.sig.length === t.sig.length) t.sig = t.sig.map((v, j) => v * 0.9 + d.sig[j] * 0.1);
  };

  for (let i = 0; i < n; i++) {
    const dets = an.frames[i].map((d, k) => ({ d, k, p: toFloor(floor, d) })).filter((e) => e.d.s >= 0.25);
    const pairs: { t: Raw; e: (typeof dets)[number]; cost: number }[] = [];
    for (const t of live) {
      const gap = (i - t.last) / fps;
      if (gap > 10) continue;
      const gate = Math.min(5, 0.7 + 2.2 * gap);
      for (const e of dets) {
        const dist = Math.hypot(e.p.x - t.lx, e.p.y - t.ly);
        if (dist > gate) continue;
        pairs.push({ t, e, cost: dist / gate + 0.9 * sigDistance(t.sig, e.d.sig) + 0.04 * gap });
      }
    }
    pairs.sort((a, b) => a.cost - b.cost);
    const usedTracks = new Set<Raw>();
    const usedDets = new Set<number>();
    const taken: { x: number; y: number }[] = [];
    for (const { t, e } of pairs) {
      if (usedTracks.has(t) || usedDets.has(e.k)) continue;
      usedTracks.add(t);
      usedDets.add(e.k);
      record(t, i, e.k, e.d, e.p.x, e.p.y);
      taken.push(e.p);
    }
    for (const e of dets) {
      if (usedDets.has(e.k) || e.d.s < 0.35) continue;
      if (taken.some((p) => Math.hypot(p.x - e.p.x, p.y - e.p.y) < 0.3)) continue;
      const t: Raw = { xs: new Array<number>(n).fill(NaN), ys: new Array<number>(n).fill(NaN), det: new Int16Array(n).fill(-1), last: i, count: 0, sig: e.d.sig.slice(), lx: e.p.x, ly: e.p.y };
      record(t, i, e.k, e.d, e.p.x, e.p.y);
      live.push(t);
      taken.push(e.p);
    }
  }

  // pieces of the same person (lost behind someone, found again): join them, drop what is left
  let tracks = live.filter((t) => t.count >= Math.max(3, n * 0.02));
  while (tracks.length > target) {
    tracks.sort((a, b) => b.count - a.count);
    const piece = tracks.pop()!;
    let best: Raw | null = null;
    let bestCost = 1.6;
    for (const host of tracks) {
      const c = joinCost(host, piece, fps);
      if (c < bestCost) {
        bestCost = c;
        best = host;
      }
    }
    if (best) join(best, piece);
  }
  tracks = tracks.filter((t) => t.count >= Math.max(3, n * 0.05) || tracks.length <= target);

  const out: Track[] = tracks.map((t) => ({
    xs: smooth(fill(t.xs)),
    ys: smooth(fill(t.ys)),
    seen: Uint8Array.from(t.det, (v) => (v >= 0 ? 1 : 0)),
    det: t.det,
    sig: t.sig,
  }));
  out.sort((a, b) => median(a.xs) - median(b.xs));
  return { people: target, suggested, tracks: out };
}

function joinCost(host: Raw, piece: Raw, fps: number) {
  const n = host.xs.length;
  let overlap = 0;
  for (let i = 0; i < n; i++) if (piece.det[i] >= 0 && host.det[i] >= 0) overlap++;
  if (overlap > Math.max(2, piece.count * 0.1)) return Infinity;
  let cost = 0;
  let checks = 0;
  const step = (from: number, to: number) => {
    const gap = Math.abs(to - from) / fps;
    const allowed = Math.min(6, 0.8 + 2.2 * gap);
    const d = Math.hypot(host.xs[from] - piece.xs[to], host.ys[from] - piece.ys[to]);
    return d > allowed * 1.3 ? Infinity : d / allowed;
  };
  for (let i = 0; i < n; i++) {
    if (piece.det[i] < 0) continue;
    if (i === 0 || piece.det[i - 1] < 0) {
      let p = i - 1;
      while (p >= 0 && host.det[p] < 0) p--;
      if (p >= 0) {
        const c = step(p, i);
        if (!Number.isFinite(c)) return Infinity;
        cost += c;
        checks++;
      }
    }
    if (i === n - 1 || piece.det[i + 1] < 0) {
      let q = i + 1;
      while (q < n && host.det[q] < 0) q++;
      if (q < n) {
        const c = step(q, i);
        if (!Number.isFinite(c)) return Infinity;
        cost += c;
        checks++;
      }
    }
  }
  return (checks ? cost / checks : 0.5) + 1.2 * sigDistance(host.sig, piece.sig);
}

function join(host: Raw, piece: Raw) {
  const n = host.xs.length;
  for (let i = 0; i < n; i++) {
    if (piece.det[i] < 0 || host.det[i] >= 0) continue;
    host.xs[i] = piece.xs[i];
    host.ys[i] = piece.ys[i];
    host.det[i] = piece.det[i];
  }
  const total = host.count + piece.count;
  if (host.sig.length === piece.sig.length) host.sig = host.sig.map((v, j) => (v * host.count + piece.sig[j] * piece.count) / total);
  host.count = 0;
  for (let i = 0; i < n; i++) if (host.det[i] >= 0) host.count++;
}

/** Positions where the person was not seen: straight line between the two sightings around. */
function fill(values: number[]): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  let prev = -1;
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(values[i])) continue;
    if (prev < 0) for (let j = 0; j < i; j++) out[j] = values[i];
    else for (let j = prev + 1; j < i; j++) out[j] = values[prev] + ((values[i] - values[prev]) * (j - prev)) / (i - prev);
    out[i] = values[i];
    prev = i;
  }
  if (prev >= 0) for (let j = prev + 1; j < n; j++) out[j] = values[prev];
  return out;
}

/** Removes the jitter of the boxes (jumps, arms, bent knees). */
function smooth(values: Float32Array): Float32Array {
  const n = values.length;
  const mid = new Float32Array(n);
  const win: number[] = [];
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) win.push(values[j]);
    win.sort((a, b) => a - b);
    mid[i] = win[win.length >> 1];
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = mid[Math.max(0, i - 1)];
    const c = mid[Math.min(n - 1, i + 1)];
    out[i] = (a + mid[i] + c) / 3;
  }
  return out;
}

/** A clear picture of each person (for "who dances who"): a big, well separated box on a saved image. */
export function thumbFor(an: Analysis, track: Track) {
  let best: { url: string; box: { x: number; y: number; w: number; h: number } } | null = null;
  let bestScore = 0;
  for (const kf of an.keyframes) {
    const k = track.det[kf.index];
    if (k < 0) continue;
    const frame = an.frames[kf.index];
    const d = frame[k];
    if (!d) continue;
    let covered = 0;
    for (let j = 0; j < frame.length; j++) {
      if (j === k) continue;
      const o = frame[j];
      const w = Math.min(d.x + d.w, o.x + o.w) - Math.max(d.x, o.x);
      const h = Math.min(d.y + d.h, o.y + o.h) - Math.max(d.y, o.y);
      if (w > 0 && h > 0) covered = Math.max(covered, (w * h) / (d.w * d.h));
    }
    const score = d.s * (1 - covered) * Math.min(1, d.h / 0.3);
    if (score > bestScore) {
      bestScore = score;
      const px = d.w * 0.15;
      const py = d.h * 0.06;
      const x = Math.max(0, d.x - px);
      const y = Math.max(0, d.y - py);
      best = { url: kf.url, box: { x, y, w: Math.min(1 - x, d.w + 2 * px), h: Math.min(1 - y, d.h + 2 * py) } };
    }
  }
  return best;
}
