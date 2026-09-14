import type { Analysis, Det } from './analysis';
import { median, personHeight, toFloor, type FloorModel } from './floor';
import { meanSignature, sigDistance } from './signature';

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
  /** Per person: how surely the app tells them apart from the others (0..1; below ~0.5: worth checking). */
  confidence: number[];
}

/** A stretch where we are sure it is the same person (nobody else close). */
interface Piece {
  idx: number[];
  xs: number[];
  ys: number[];
  det: number[];
  looks: number[][];
  crowdedLooks: number[][];
  heights: number[];
  sig: number[];
  /** Height compared with the usual height at that spot (tall and small dancers differ). */
  rh: number;
  weight: number;
  lx: number;
  ly: number;
  vx: number;
  vy: number;
  last: number;
}

interface Person {
  pieces: Piece[];
  sig: number[];
  rh: number;
  lastIdx: number;
  lx: number;
  ly: number;
  vx: number;
  vy: number;
}

interface Entry {
  d: Det;
  k: number;
  p: { x: number; y: number };
  crowded: boolean;
}

const first = (p: Piece) => p.idx[0];
const last = (p: Piece) => p.idx[p.idx.length - 1];
const len = (p: Piece) => p.idx.length;

/** Usual number of people in the video (most images show everyone, some hide a dancer behind another). */
export function suggestedPeople(an: Analysis) {
  const counts = an.frames.map((f) => f.filter((d) => d.s >= 0.3).length).sort((a, b) => a - b);
  return Math.max(1, counts[Math.floor((counts.length - 1) * 0.8)] ?? 1);
}

function covered(d: Det, o: Det) {
  const w = Math.min(d.x + d.w, o.x + o.w) - Math.max(d.x, o.x);
  const h = Math.min(d.y + d.h, o.y + o.h) - Math.max(d.y, o.y);
  return w > 0 && h > 0 ? (w * h) / Math.min(d.w * d.h, o.w * o.h) : 0;
}

const heightGap = (a: number, b: number) => (Number.isFinite(a) && Number.isFinite(b) ? Math.min(1, Math.abs(a - b) / 0.12) : 0.3);

/**
 * 1. Sure stretches: each person is expected where their move leads them; a stretch stops when two people get close.
 * 2. The stretches are sorted into N looks (hair, top, arms, pants, shoes, height): never two places at once,
 *    never a walk faster than possible.
 * 3. A last check swaps two people's futures where they crossed, when their looks match better that way.
 */
export function trackPeople(an: Analysis, floor: FloorModel, people?: number): Tracking {
  const n = an.times.length;
  const fps = an.fps;
  const suggested = suggestedPeople(an);
  const target = Math.max(1, Math.round(people || suggested));
  const cached = cache.get(an);
  if (cached?.target === target) return cached.tracking;

  const pieces = cached?.pieces ?? buildPieces(an, floor);
  const persons = groupPieces(pieces, n, fps, target);
  refine(persons, fps);
  // a person is sure when their look is far from everyone else's and their stretches agree with each other
  const confidence = persons.map((person, k) => {
    const others = persons.filter((_, j) => j !== k);
    const apart = others.length ? Math.min(...others.map((o) => sigDistance(person.sig, o.sig))) : 1;
    const own = person.pieces.filter((p) => p.weight > 0);
    const spread = own.length ? own.reduce((sum, p) => sum + sigDistance(person.sig, p.sig) * p.weight, 0) / own.reduce((sum, p) => sum + p.weight, 0) : 0.3;
    return Math.max(0, Math.min(1, (apart - spread * 0.5) / 0.25));
  });

  const out: Track[] = persons.map((person) => {
    const xs = new Array<number>(n).fill(NaN);
    const ys = new Array<number>(n).fill(NaN);
    const det = new Int16Array(n).fill(-1);
    for (const p of person.pieces)
      p.idx.forEach((i, k) => {
        if (det[i] >= 0) return;
        xs[i] = p.xs[k];
        ys[i] = p.ys[k];
        det[i] = p.det[k];
      });
    return { xs: smooth(fill(xs)), ys: smooth(fill(ys)), seen: Uint8Array.from(det, (v) => (v >= 0 ? 1 : 0)), det, sig: person.sig };
  });
  const order = out.map((t, k) => ({ t, k, x: median(t.xs) })).sort((a, b) => a.x - b.x);
  const tracking = { people: target, suggested, tracks: order.map((o) => o.t), confidence: order.map((o) => confidence[o.k]) };
  cache.set(an, { target, pieces, tracking });
  return tracking;
}

/** The last tracking of each analysis (the review changes "people", "Place from the image" needs the same placement). */
const cache = new WeakMap<Analysis, { target: number; pieces: Piece[]; tracking: Tracking }>();

/* ------------------------------------------------------------------------ */

/** Doubt zone around a predicted position (m, growing with the time since the last image): another person inside it ends the sure stretch. */
const MARGIN_BASE = 0.12;
const MARGIN_PER_S = 0.9;

function buildPieces(an: Analysis, floor: FloorModel): Piece[] {
  const n = an.times.length;
  const fps = an.fps;
  const pieces: Piece[] = [];
  let active: Piece[] = [];

  const times = an.times;
  const add = (t: Piece, i: number, e: Entry) => {
    if (t.idx.length) {
      const dt = Math.max(0.02, times[i] - times[t.last]);
      let vx = (e.p.x - t.lx) / dt;
      let vy = (e.p.y - t.ly) / dt;
      const speed = Math.hypot(vx, vy);
      if (speed > 4) {
        vx *= 4 / speed;
        vy *= 4 / speed;
      }
      const keep = t.idx.length > 1 ? 0.5 : 0;
      t.vx = t.vx * keep + vx * (1 - keep);
      t.vy = t.vy * keep + vy * (1 - keep);
    }
    t.idx.push(i);
    t.xs.push(e.p.x);
    t.ys.push(e.p.y);
    t.det.push(e.k);
    t.lx = e.p.x;
    t.ly = e.p.y;
    t.last = i;
    if (e.d.sig.length && e.d.s >= 0.35) (e.crowded ? t.crowdedLooks : t.looks).push(e.d.sig);
    const standing = (e.d.h * an.height) / Math.max(1e-6, e.d.w * an.width) > 1.6;
    if (!e.crowded && standing && e.d.s >= 0.45 && e.d.y > 0.005 && e.d.y + e.d.h < 0.985) t.heights.push(e.d.h / personHeight(floor, Math.min(1, e.d.y + e.d.h)));
  };
  const start = (i: number, e: Entry) => {
    const piece: Piece = { idx: [], xs: [], ys: [], det: [], looks: [], crowdedLooks: [], heights: [], sig: [], rh: NaN, weight: 0, lx: 0, ly: 0, vx: 0, vy: 0, last: i };
    add(piece, i, e);
    pieces.push(piece);
    return piece;
  };

  for (let i = 0; i < n; i++) {
    const frame = an.frames[i];
    const dets: Entry[] = frame.map((d, k) => ({ d, k, p: toFloor(floor, d), crowded: frame.some((o, j) => j !== k && covered(d, o) > 0.25) })).filter((e) => e.d.s >= 0.25);
    active = active.filter((t) => times[i] - times[t.last] <= 3 / fps + 0.05);
    const expected = active.map((t) => {
      const dt = Math.min(times[i] - times[t.last], 0.7);
      return { x: t.lx + t.vx * dt, y: t.ly + t.vy * dt };
    });
    const pairs: { a: number; e: Entry; dist: number }[] = [];
    active.forEach((t, a) => {
      const gate = 0.25 + 1.5 * (times[i] - times[t.last]);
      for (const e of dets) {
        const dist = Math.hypot(e.p.x - expected[a].x, e.p.y - expected[a].y);
        if (dist <= gate) pairs.push({ a, e, dist });
      }
    });
    pairs.sort((x, y) => x.dist - y.dist);
    const usedT = new Set<number>();
    const usedE = new Set<number>();
    const next: Piece[] = [];
    for (const { a, e, dist } of pairs) {
      if (usedT.has(a) || usedE.has(e.k)) continue;
      usedT.add(a);
      usedE.add(e.k);
      const t = active[a];
      // close images (extra ones around a crossing) make the prediction precise: a smaller doubt zone
      const margin = Math.max(MARGIN_BASE + MARGIN_PER_S * (times[i] - times[t.last]), dist * 1.6);
      const unsure =
        dets.some((o) => o !== e && Math.hypot(o.p.x - expected[a].x, o.p.y - expected[a].y) < margin) ||
        expected.some((o, b) => b !== a && Math.hypot(e.p.x - o.x, e.p.y - o.y) < margin);
      if (unsure) next.push(start(i, e));
      else {
        add(t, i, e);
        next.push(t);
      }
    }
    for (const e of dets) {
      if (usedE.has(e.k) || e.d.s < 0.3) continue;
      if (dets.some((o) => o !== e && usedE.has(o.k) && Math.hypot(o.p.x - e.p.x, o.p.y - e.p.y) < 0.3)) continue;
      usedE.add(e.k);
      next.push(start(i, e));
    }
    // stretches not seen on this image stay open a little (someone hidden for a moment)
    active.forEach((t, a) => {
      if (!usedT.has(a)) next.push(t);
    });
    active = next;
  }

  for (const p of pieces) {
    p.sig = meanSignature(p.looks.length ? p.looks : p.crowdedLooks);
    p.weight = p.looks.length || p.crowdedLooks.length * 0.3;
    p.rh = p.heights.length >= 3 ? median(p.heights) : NaN;
  }
  return pieces;
}

/* ------------------------------------------------------------------------ */

function summarize(person: Person) {
  person.pieces.sort((a, b) => first(a) - first(b));
  if (!person.pieces.length) return;
  person.sig = meanSignature(
    person.pieces.map((p) => p.sig),
    person.pieces.map((p) => p.weight),
  );
  let hw = 0;
  let hs = 0;
  for (const p of person.pieces)
    if (Number.isFinite(p.rh)) {
      hs += p.rh * p.heights.length;
      hw += p.heights.length;
    }
  person.rh = hw ? hs / hw : NaN;
  const end = person.pieces.reduce((best, p) => (last(p) > last(best) ? p : best), person.pieces[0]);
  person.lastIdx = last(end);
  person.lx = end.lx;
  person.ly = end.ly;
  person.vx = end.vx;
  person.vy = end.vy;
}

/** Could the person (these stretches) reach this stretch in time? Infinity = no (it would be a teleport). */
function reachCost(list: Piece[], p: Piece, fps: number) {
  let before: Piece | null = null;
  let after: Piece | null = null;
  for (const q of list) {
    if (last(q) < first(p) && (!before || last(q) > last(before))) before = q;
    if (first(q) > last(p) && (!after || first(q) < first(after))) after = q;
  }
  let cost = 0;
  let checks = 0;
  if (before) {
    const allowed = 1 + 3 * ((first(p) - last(before)) / fps);
    const d = Math.hypot(p.xs[0] - before.lx, p.ys[0] - before.ly);
    if (d > allowed) return Infinity;
    cost += d / allowed;
    checks++;
  }
  if (after) {
    const allowed = 1 + 3 * ((first(after) - last(p)) / fps);
    const d = Math.hypot(after.xs[0] - p.lx, after.ys[0] - p.ly);
    if (d > allowed) return Infinity;
    cost += d / allowed;
    checks++;
  }
  return checks ? cost / checks : 0;
}

/**
 * The stretches are sorted into N looks: each goes to the closest look, never to a person already seen
 * elsewhere at the same moment, never somewhere the person could not have walked to. The looks are measured
 * again from what they received, until nothing changes.
 */
/** Weights of the grouping: moves (a stretch starting where the person just was), height, and when a stretch is left out. */
export interface GroupTuning {
  motion: number;
  height: number;
  leaveOut: number;
  /** Starting moments tried (the sorting with the lowest total cost wins). */
  starts: number;
}
/** Chosen on a hand-labelled dance practice (6 dancers, 4 dressed in black), robust over several analyses of it. */
const GROUP_TUNING: GroupTuning = { motion: 0.1, height: 0.1, leaveOut: 0.55, starts: 20 };

function groupPieces(pieces: Piece[], n: number, fps: number, target: number, tuning: GroupTuning = GROUP_TUNING): Person[] {
  const usable = pieces.filter((p) => len(p) >= 2 && p.weight > 0).sort((a, b) => len(b) - len(a));
  const long = usable.filter((p) => len(p) >= fps);
  // starting looks: moments when the most people are seen for a long time, all at once (surely different people)
  const index = new Map(pieces.map((p, k) => [p, k]));
  const keyOf = (list: Piece[]) => list.map((p) => index.get(p)!).sort((x, y) => x - y).join(',');
  const starts = new Map<string, { pieces: Piece[]; score: number }>();
  // long stretches covering each image, found by sweeping once
  const openAt: Piece[][] = Array.from({ length: n + 1 }, () => []);
  const closeAt: Piece[][] = Array.from({ length: n + 1 }, () => []);
  for (const p of long) {
    openAt[first(p)].push(p);
    closeAt[last(p) + 1].push(p);
  }
  let here = new Set<Piece>();
  for (let i = 0; i < n; i++) {
    for (const p of closeAt[i]) here.delete(p);
    for (const p of openAt[i]) here.add(p);
    if (!here.size) continue;
    const list = [...here].sort((a, b) => len(b) - len(a)).slice(0, target);
    const score = list.length * 10000 + len(list[list.length - 1]);
    const key = keyOf(list);
    const same = starts.get(key);
    if (same) same.score = Math.max(same.score, score);
    else starts.set(key, { pieces: list, score });
  }
  const ranked = [...starts.values()].sort((x, y) => y.score - x.score);

  let best: { persons: Person[]; cost: number } | null = null;
  // a few different starting moments: keep the sorting where everyone looks most like themselves
  for (const start of ranked.slice(0, tuning.starts)) {
    let centers = start.pieces.map((p) => ({ sig: p.sig, rh: p.rh }));
    for (const p of long) {
      if (centers.length >= target) break;
      if (Math.min(...centers.map((c) => sigDistance(c.sig, p.sig))) > 0.25) centers.push({ sig: p.sig, rh: p.rh });
    }
    let persons: Person[] = [];
    let cost = 0;
    let previous = '';
    for (let round = 0; round < 12; round++) {
      const occupied = centers.map(() => new Int8Array(n));
      const lists: Piece[][] = centers.map(() => []);
      cost = 0;
      for (const p of usable) {
        let pick = -1;
        let pickCost = Infinity;
        centers.forEach((c, k) => {
          if (p.idx.some((i) => occupied[k][i])) return;
          const reach = reachCost(lists[k], p, fps);
          if (!Number.isFinite(reach)) return;
          const c2 = sigDistance(c.sig, p.sig) + tuning.height * heightGap(c.rh, p.rh) + tuning.motion * reach;
          if (c2 < pickCost) {
            pickCost = c2;
            pick = k;
          }
        });
        if (pick < 0 || (pickCost > tuning.leaveOut && len(p) < fps)) {
          cost += p.weight * 0.6;
          continue;
        }
        cost += p.weight * pickCost;
        lists[pick].push(p);
        for (const i of p.idx) occupied[pick][i] = 1;
      }
      persons = lists.map((list) => {
        const person: Person = { pieces: list, sig: [], rh: NaN, lastIdx: -1, lx: 0, ly: 0, vx: 0, vy: 0 };
        summarize(person);
        return person;
      });
      const key = lists.map(keyOf).join('|');
      if (key === previous) break;
      previous = key;
      centers = persons.map((person, k) => (person.pieces.length ? { sig: person.sig, rh: person.rh } : centers[k]));
    }
    if (!best || cost < best.cost) best = { persons, cost };
  }
  return (best?.persons ?? []).filter((person) => person.pieces.length);
}

/** Look + height of a run of stretches (from prefix sums, fast). */
interface Runs {
  pieces: Piece[];
  sums: Float64Array[];
  weights: number[];
  heightSums: number[];
  heightCounts: number[];
}

function runsOf(person: Person): Runs {
  const L = person.sig.length;
  const sums = [new Float64Array(L)];
  const weights = [0];
  const heightSums = [0];
  const heightCounts = [0];
  person.pieces.forEach((p, k) => {
    const s = new Float64Array(sums[k]);
    if (p.sig.length === L) for (let i = 0; i < L; i++) s[i] += p.sig[i] * p.weight;
    sums.push(s);
    weights.push(weights[k] + p.weight);
    const hc = Number.isFinite(p.rh) ? p.heights.length : 0;
    heightSums.push(heightSums[k] + (hc ? p.rh * hc : 0));
    heightCounts.push(heightCounts[k] + hc);
  });
  return { pieces: person.pieces, sums, weights, heightSums, heightCounts };
}

function runLook(r: Runs, a: number, b: number) {
  const w = r.weights[b] - r.weights[a];
  if (w <= 0) return null;
  const sig = Array.from(r.sums[b], (v, i) => (v - r.sums[a][i]) / w);
  const hc = r.heightCounts[b] - r.heightCounts[a];
  return { sig, rh: hc ? (r.heightSums[b] - r.heightSums[a]) / hc : NaN };
}

function refine(persons: Person[], fps: number) {
  const lookGap = (x: ReturnType<typeof runLook>, y: ReturnType<typeof runLook>) => (!x || !y ? 0.25 : sigDistance(x.sig, y.sig) + 0.8 * heightGap(x.rh, y.rh));
  const end = (list: Piece[]) => list.reduce<Piece | null>((best, p) => (!best || last(p) > last(best) ? p : best), null);
  const join = (before: Piece[], after: Piece[]) => {
    const e = end(before);
    if (!e || !after.length) return true;
    const s = after[0];
    if (last(e) >= first(s)) return false;
    const gap = (first(s) - last(e)) / fps;
    return Math.hypot(s.xs[0] - e.lx, s.ys[0] - e.ly) <= 1 + 3.2 * gap;
  };
  for (let round = 0; round < 40; round++) {
    let changed = false;
    for (let a = 0; a < persons.length && !changed; a++)
      for (let b = a + 1; b < persons.length && !changed; b++) {
        const A = runsOf(persons[a]);
        const B = runsOf(persons[b]);
        const cuts = [...new Set([...A.pieces.map(first), ...B.pieces.map(first)])].sort((x, y) => x - y);
        for (const t of cuts) {
          const ca = A.pieces.findIndex((p) => first(p) >= t);
          const cb = B.pieces.findIndex((p) => first(p) >= t);
          const ia = ca < 0 ? A.pieces.length : ca;
          const ib = cb < 0 ? B.pieces.length : cb;
          const A1 = A.pieces.slice(0, ia);
          const A2 = A.pieces.slice(ia);
          const B1 = B.pieces.slice(0, ib);
          const B2 = B.pieces.slice(ib);
          if ((!A2.length && !B2.length) || (!A1.length && !B1.length)) continue;
          // only where the two were close (a crossing): elsewhere a swap would be a teleport
          const ea = end(A1);
          const eb = end(B1);
          if (!ea || !eb || Math.hypot(ea.lx - eb.lx, ea.ly - eb.ly) > 2) continue;
          if (!join(A1, B2) || !join(B1, A2)) continue;
          const a1 = runLook(A, 0, ia);
          const a2 = runLook(A, ia, A.pieces.length);
          const b1 = runLook(B, 0, ib);
          const b2 = runLook(B, ib, B.pieces.length);
          const keep = lookGap(a1, a2) + lookGap(b1, b2);
          const swap = lookGap(a1, b2) + lookGap(b1, a2);
          if (swap < keep - 0.04) {
            persons[a].pieces = [...A1, ...B2];
            persons[b].pieces = [...B1, ...A2];
            summarize(persons[a]);
            summarize(persons[b]);
            changed = true;
            break;
          }
        }
      }
    if (!changed) break;
  }
}

/** Positions where the person was not seen: straight line between the two sightings around. */
function fill(values: ArrayLike<number>): Float32Array {
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

/** A clear picture of each person (for "who dances who"): big, apart from others, and looking like the person usually does. */
export function thumbFor(an: Analysis, track: Track) {
  let best: { url: string; box: { x: number; y: number; w: number; h: number } } | null = null;
  let bestScore = 0;
  for (const kf of an.thumbs) {
    const k = track.det[kf.index];
    if (k < 0) continue;
    const frame = an.frames[kf.index];
    const d = frame[k];
    if (!d) continue;
    let hidden = 0;
    for (let j = 0; j < frame.length; j++) if (j !== k) hidden = Math.max(hidden, covered(d, frame[j]));
    const typical = 1 - Math.min(1, sigDistance(d.sig, track.sig) * 1.6);
    const score = d.s * (1 - Math.min(1, hidden)) * Math.min(1, d.h / 0.3) * typical * typical;
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

/** Pictures of a person through the video (checking who is who). */
export function crops(an: Analysis, track: Track, count: number) {
  const seen = an.thumbs.filter((kf) => track.det[kf.index] >= 0);
  const step = Math.max(1, seen.length / count);
  const out: { url: string; time: number; box: Det }[] = [];
  for (let i = 0; i < seen.length && out.length < count; i += step) {
    const kf = seen[Math.floor(i)];
    out.push({ url: kf.url, time: an.times[kf.index], box: an.frames[kf.index][track.det[kf.index]] });
  }
  return out;
}

/** Steps of the tracking, for checking them one by one. */
export const trackingSteps = { buildPieces, groupPieces, refine };
