import { r2 } from '../lib/geometry';
import { uid } from '../lib/id';
import { clampToStage, computeFrame, snapTime, sortedDancers, sortedFormations, timeline } from '../lib/model';
import type { Choreo, Dancer, ID, PathSpec, Position, StageSettings, Vec } from '../lib/types';
import type { Analysis, GhostAnchor, Ghosts, ReviewSettings, Swap } from './analysis';
import { median, percentile } from './floor';
import type { Track } from './track';

export type Placement = ReviewSettings['placement'];
export type Transform = ReviewSettings['transform'];
export type ApplyMode = ReviewSettings['mode'];

/** Real distances (meters), the middle of the room (camera axis) on the middle of the stage. */
export const DEFAULT_PLACEMENT: Placement = { flip: false, spread: 1, depth: 1, fill: false, centre: 'room', shift: 0 };

export const centreOf = (placement: Placement) => placement.centre ?? 'room';

/**
 * Each formation centred left-right on its middle dancer ("Milieu du groupe"): for a video whose camera is not in the
 * middle of the room. It also moves formations that are meant to stand on one side, hence not the default.
 */
export function centerFormations(formations: DetectedFormation[]): DetectedFormation[] {
  return formations.map((f) => ({ ...f, positions: centred(f.positions) }));
}

/**
 * The middle of a formation, left-right: the dancer in the middle (odd number of people) or halfway between the two in
 * the middle (even number). Unlike the average, one dancer standing apart does not pull everyone off the centre line.
 */
export function middleX(positions: Vec[]) {
  if (!positions.length) return 0;
  const xs = positions.map((p) => p.x).sort((a, b) => a - b);
  const m = xs.length >> 1;
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

/** Positions moved left-right so the middle of the formation is on the centre line. */
export function centred(positions: Vec[]): Vec[] {
  if (!positions.length) return positions;
  const mid = middleX(positions);
  return positions.map((p) => ({ x: p.x - mid, y: p.y }));
}

/** Positions on the stage (meters, same axes as the editor) over time. */
export interface Placed {
  xs: Float32Array;
  ys: Float32Array;
  seen: Uint8Array;
}

/** A formation found in the video: everyone holds still between `start` and `end` (video time). */
export interface DetectedFormation {
  start: number;
  end: number;
  /** Analysed images (index ranges) the formation is held on. */
  ranges: [number, number][];
  positions: Vec[];
}

export function applyTransform(t: Transform, p: Vec): Vec {
  const x = (t.flip ? -p.x : p.x) * t.spread;
  const y = p.y * t.depth;
  return { x: (x - t.ox) * t.s, y: (y - t.oy) * t.s };
}

/** Two people mixed up by the tracking: exchange them from an image onwards. */
export function applySwaps(tracks: Track[], swaps: Swap[]): Track[] {
  if (!swaps.length) return tracks;
  const out = tracks.map((t) => ({ xs: t.xs.slice(), ys: t.ys.slice(), seen: t.seen.slice(), det: t.det.slice(), sig: t.sig }));
  for (const { from, a, b } of swaps) {
    if (!out[a] || !out[b] || a === b) continue;
    for (const key of ['xs', 'ys', 'seen', 'det'] as const) {
      const A = out[a][key];
      const B = out[b][key];
      for (let i = Math.max(0, from); i < A.length; i++) {
        const v = A[i];
        A[i] = B[i];
        B[i] = v;
      }
    }
  }
  return out;
}

/**
 * Puts the group on the stage, real distances, made smaller only when it would not fit ("fill": as big as the stage
 * allows). Left-right, the middle of the room is the camera axis (dance practices are filmed from the middle of the
 * mirror), moved by `shift`; front-back, where the group usually stands is the middle of the stage.
 */
export function placeTracks(tracks: Track[], stage: StageSettings, placement: Placement): { tracks: Placed[]; transform: Transform } {
  const transform: Transform = { flip: placement.flip, spread: placement.spread, depth: placement.depth, ox: 0, oy: 0, s: 1 };
  const n = tracks[0]?.xs.length ?? 0;
  const xs: number[] = [];
  const ys: number[] = [];
  const middleX: number[] = [];
  const middleY: number[] = [];
  const enough = Math.max(1, Math.ceil(tracks.length / 2));
  for (let i = 0; i < n; i++) {
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (const t of tracks) {
      if (!t.seen[i]) continue;
      const p = applyTransform(transform, { x: t.xs[i], y: t.ys[i] });
      xs.push(p.x);
      ys.push(p.y);
      sx += p.x;
      sy += p.y;
      count++;
    }
    if (count >= enough) {
      middleX.push(sx / count);
      middleY.push(sy / count);
    }
  }
  if (xs.length) {
    const room = centreOf(placement) === 'room';
    transform.ox = room ? 0 : middleX.length ? median(middleX) : (percentile(xs, 0.03) + percentile(xs, 0.97)) / 2;
    transform.oy = middleY.length ? median(middleY) : (percentile(ys, 0.03) + percentile(ys, 0.97)) / 2;
    const halfW = Math.max(0.25, Math.abs(percentile(xs, 0.03) - transform.ox), Math.abs(percentile(xs, 0.97) - transform.ox));
    const halfD = Math.max(0.25, Math.abs(percentile(ys, 0.03) - transform.oy), Math.abs(percentile(ys, 0.97) - transform.oy));
    const fit = Math.min((stage.width / 2) * 0.92 / halfW, (stage.depth / 2) * 0.92 / halfD);
    transform.s = placement.fill ? Math.max(0.3, Math.min(2.5, fit)) : Math.min(1, fit);
    // stage x = (x - ox) × s: a shift of `shift` meters on the stage
    if (room && placement.shift) transform.ox = -placement.shift / transform.s;
  }
  return {
    transform,
    tracks: tracks.map((t) => {
      const X = new Float32Array(t.xs.length);
      const Y = new Float32Array(t.xs.length);
      for (let i = 0; i < t.xs.length; i++) {
        const p = applyTransform(transform, { x: t.xs[i], y: t.ys[i] });
        X[i] = p.x;
        Y[i] = p.y;
      }
      return { xs: X, ys: Y, seen: t.seen };
    }),
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export interface FormationTuning {
  /** Seconds before and after each image used to measure moves. */
  window: number;
  /** Speed (m/s) under which the group holds; found from the video when not given. */
  threshold?: number;
  /** Shortest formation (s). */
  minHold: number;
  /** Two formations closer than this (m, on average) are one. */
  mergeDistance: number;
}

/** `sensitivity` 0..1: more formations (shorter, closer to each other) when higher. */
export const tuningFor = (sensitivity: number): FormationTuning => ({
  window: 0.6,
  minHold: lerp(2.2, 0.7, sensitivity),
  mergeDistance: lerp(0.9, 0.25, sensitivity),
});

/** Median position of each person over some analysed images. */
export function positionsOver(tracks: Placed[], ranges: [number, number][]): Vec[] {
  return tracks.map((t) => {
    const X: number[] = [];
    const Y: number[] = [];
    for (const [a, b] of ranges)
      for (let i = a; i <= b; i++) {
        X.push(t.xs[i]);
        Y.push(t.ys[i]);
      }
    return { x: median(X), y: median(Y) };
  });
}

/** How much the group moves around each image (m/s): the fastest third of the people. */
export function groupSpeed(tracks: Placed[], times: number[], window: number) {
  const n = tracks[0]?.xs.length ?? 0;
  const top = Math.max(1, Math.ceil(tracks.length / 3));
  const speed = new Float32Array(n);
  const moving: number[] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < n; i++) {
    // images `window` seconds before and after (they are not evenly spaced)
    while (a < i && times[i] - times[a] > window) a++;
    while (b < n - 1 && times[b + 1] - times[i] <= window) b++;
    const dt = times[b] - times[a] || 1;
    moving.length = 0;
    for (const t of tracks) moving.push(Math.hypot(t.xs[b] - t.xs[a], t.ys[b] - t.ys[a]) / dt);
    moving.sort((x, y) => y - x);
    let sum = 0;
    for (let k = 0; k < top; k++) sum += moving[k];
    speed[i] = sum / top;
  }
  return speed;
}

/** Formations = moments when the group holds its places; between them, transitions. */
export function findFormations(tracks: Placed[], times: number[], fps: number, sensitivity: number, override: Partial<FormationTuning> = {}): DetectedFormation[] {
  const n = times.length;
  if (!n || !tracks.length) return [];
  const tune = { ...tuningFor(sensitivity), ...override };
  const speed = groupSpeed(tracks, times, tune.window);
  // dancing in place moves the feet a little: the usual calm level of this video sets the bar
  const threshold = tune.threshold ?? Math.max(0.2, Math.min(0.9, percentile(speed, 0.3) * 1.8));
  const minHold = Math.max(1, Math.round(tune.minHold * fps));

  const holds: { ranges: [number, number][]; positions: Vec[] }[] = [];
  let startRun = -1;
  for (let i = 0; i <= n; i++) {
    const still = i < n && speed[i] < threshold;
    if (still && startRun < 0) startRun = i;
    if (!still && startRun >= 0) {
      if (i - startRun >= minHold) holds.push({ ranges: [[startRun, i - 1]], positions: positionsOver(tracks, [[startRun, i - 1]]) });
      startRun = -1;
    }
  }
  // the same places held again after a small move: one formation
  const merged: typeof holds = [];
  for (const h of holds) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const moved = prev.positions.reduce((sum, p, k) => sum + Math.hypot(p.x - h.positions[k].x, p.y - h.positions[k].y), 0) / tracks.length;
      if (moved < tune.mergeDistance) {
        prev.ranges.push(...h.ranges);
        prev.positions = positionsOver(tracks, prev.ranges);
        continue;
      }
    }
    merged.push({ ranges: [...h.ranges], positions: h.positions });
  }
  if (!merged.length) merged.push({ ranges: [[0, n - 1]], positions: positionsOver(tracks, [[0, n - 1]]) });

  // long moves still pass through places (a short pause on a count): keep them as short formations
  const maxMove = Math.max(2, Math.round(lerp(7, 3, sensitivity) * fps));
  const edge = Math.max(1, Math.round(fps * 0.8));
  const out: typeof merged = [];
  const between = (a: number, b: number) => {
    if (b - a + 1 <= maxMove) return;
    let calmest = -1;
    for (let i = a + edge; i <= b - edge; i++) if (calmest < 0 || speed[i] < speed[calmest]) calmest = i;
    if (calmest < 0) return;
    const half = Math.max(1, Math.round(fps * 0.3));
    const lo = Math.max(a, calmest - half);
    const hi = Math.min(b, calmest + half);
    between(a, lo - 1);
    out.push({ ranges: [[lo, hi]], positions: positionsOver(tracks, [[lo, hi]]) });
    between(hi + 1, b);
  };
  let last = -1;
  for (const h of merged) {
    between(last + 1, h.ranges[0][0] - 1);
    out.push(h);
    last = h.ranges[h.ranges.length - 1][1];
  }
  between(last + 1, n - 1);
  return out.map((h) => ({ start: times[h.ranges[0][0]], end: times[h.ranges[h.ranges.length - 1][1]], ranges: h.ranges, positions: h.positions }));
}

/** Ordered matching from left to right: the leftmost person goes to the leftmost dancer, and so on. */
export function defaultMapping(positions: Vec[], dancers: { id: ID; x: number }[]): (ID | null)[] {
  const people = positions.map((p, k) => ({ k, x: p.x })).sort((a, b) => a.x - b.x);
  const ds = [...dancers].sort((a, b) => a.x - b.x);
  const out: (ID | null)[] = positions.map(() => null);
  const pairs =
    people.length >= ds.length
      ? orderedMatch(people.map((p) => p.x), ds.map((d) => d.x))
      : orderedMatch(ds.map((d) => d.x), people.map((p) => p.x)).map(([j, i]) => [i, j] as [number, number]);
  for (const [i, j] of pairs) out[people[i].k] = ds[j].id;
  return out;
}

/** Every item of `short` matched to a different item of `long`, order kept, smallest total gap. */
function orderedMatch(long: number[], short: number[]): [number, number][] {
  const L = long.length;
  const S = short.length;
  if (!S) return [];
  const dp = Array.from({ length: L + 1 }, () => new Array<number>(S + 1).fill(Infinity));
  for (let i = 0; i <= L; i++) dp[i][0] = 0;
  for (let i = 1; i <= L; i++)
    for (let j = 1; j <= Math.min(i, S); j++) dp[i][j] = Math.min(dp[i - 1][j], dp[i - 1][j - 1] + Math.abs(long[i - 1] - short[j - 1]));
  const pairs: [number, number][] = [];
  let i = L;
  let j = S;
  while (j > 0 && i > 0) {
    if (dp[i][j] === dp[i - 1][j]) i--;
    else {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    }
  }
  return pairs.reverse();
}

/** Stage marks: each position goes on the nearest grid point, unless another dancer already stands there. */
export function alignToGrid(points: Vec[], stage: StageSettings): Vec[] {
  const step = stage.gridStep > 0 ? stage.gridStep : 0.5;
  const snapped = points.map((p) => ({ x: r2(Math.round(p.x / step) * step), y: r2(Math.round(p.y / step) * step) }));
  const order = points.map((_, k) => k).sort((a, b) => Math.hypot(points[a].x - snapped[a].x, points[a].y - snapped[a].y) - Math.hypot(points[b].x - snapped[b].x, points[b].y - snapped[b].y));
  const out: Vec[] = points.map((p) => ({ x: r2(p.x), y: r2(p.y) }));
  const used: Vec[] = [];
  for (const k of order) {
    if (used.some((u) => Math.hypot(u.x - snapped[k].x, u.y - snapped[k].y) < step * 0.6)) {
      used.push(out[k]);
      continue;
    }
    out[k] = snapped[k];
    used.push(snapped[k]);
  }
  return out;
}

/**
 * Positions of the chosen dancers, where they are in the video. Only when asked ("regroup"), with fewer dancers than
 * people, the kept ones are moved together towards the middle of the stage.
 */
function dancerPositions(positions: Vec[], mapping: (ID | null)[], recenter: boolean, grid: boolean, stage: StageSettings): Map<ID, Vec> {
  const mine = positions.map((p, k) => ({ p, id: mapping[k] })).filter((e): e is { p: Vec; id: ID } => !!e.id);
  let dx = 0;
  if (recenter && mine.length && mine.length < positions.length) {
    const all = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const kept = mine.reduce((s, e) => s + e.p.x, 0) / mine.length;
    dx = all - kept;
  }
  const moved = mine.map((e) => clampToStage({ x: e.p.x + dx, y: e.p.y }, stage));
  const final = grid ? alignToGrid(moved, stage) : moved.map((p) => ({ x: r2(p.x), y: r2(p.y) }));
  return new Map(mine.map((e, k) => [e.id, final[k]]));
}

const keepExtras = (old: Position | undefined): Partial<Position> => {
  const extra: Partial<Position> = {};
  if (old?.timing) extra.timing = old.timing;
  if (old?.comment) extra.comment = old.comment;
  return extra;
};

function segmentDistance(p: Vec, a: Vec, b: Vec) {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (!l2) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** Keeps the main turns of a route. */
function simplify(points: Vec[], tolerance: number): Vec[] {
  if (points.length < 3) return points;
  let far = -1;
  let max = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points[points.length - 1]);
    if (d > max) {
      max = d;
      far = i;
    }
  }
  if (max < tolerance) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, far + 1), tolerance).slice(0, -1), ...simplify(points.slice(far), tolerance)];
}

/**
 * How a dancer goes from one formation to the next, as seen in the video: when they leave and arrive
 * (share of the transition) and the turns of their route.
 */
export function routeFrom(track: Placed, from: number, to: number, start: Vec, end: Vec, stage: StageSettings, times?: number[]): Pick<Position, 'path' | 'timing'> {
  const total = to - from;
  if (total < 2) return {};
  const a0 = { x: track.xs[from], y: track.ys[from] };
  const b0 = { x: track.xs[to], y: track.ys[to] };
  // share of the transition elapsed at each image (images are not evenly spaced)
  const share = (i: number) => (times ? (times[i] - times[from]) / (times[to] - times[from] || 1) : (i - from) / total);
  // the route bent so that it starts and ends exactly on the formations' positions
  const points: Vec[] = [];
  for (let i = from; i <= to; i++) {
    const u = share(i);
    points.push({ x: track.xs[i] + (start.x - a0.x) * (1 - u) + (end.x - b0.x) * u, y: track.ys[i] + (start.y - a0.y) * (1 - u) + (end.y - b0.y) * u });
  }
  let leave = 0;
  while (leave < total && Math.hypot(points[leave].x - start.x, points[leave].y - start.y) < 0.2) leave++;
  let arrive = total;
  while (arrive > leave && Math.hypot(points[arrive].x - end.x, points[arrive].y - end.y) < 0.2) arrive--;
  if (arrive <= leave || Math.hypot(end.x - start.x, end.y - start.y) < 0.15) return {};
  const out: Pick<Position, 'path' | 'timing'> = {};
  const s = Math.max(0, share(from + Math.max(0, leave - 1)));
  const e = Math.min(1, share(from + Math.min(total, arrive + 1)));
  if ((s > 0.05 || e < 0.95) && e - s >= 0.15) out.timing = { start: r2(s), end: r2(e) };
  // a route only when the dancer was really seen moving, and it looks like a real walk (no zigzag from mix-ups)
  let seen = 0;
  for (let i = from; i <= to; i++) seen += track.seen[i];
  if (seen < (total + 1) * 0.6) return out;
  const smooth = points.map((p, i) => {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(total, i + 1)];
    return { x: (a.x + p.x + b.x) / 3, y: (a.y + p.y + b.y) / 3 };
  });
  const moving = [start, ...smooth.slice(Math.max(1, leave), Math.min(total, arrive + 1)), end];
  let walked = 0;
  for (let i = 1; i < moving.length; i++) walked += Math.hypot(moving[i].x - moving[i - 1].x, moving[i].y - moving[i - 1].y);
  const straight = Math.hypot(end.x - start.x, end.y - start.y);
  if (walked > straight * 1.8 + 0.8) return out;
  const turns = simplify(moving, 0.4)
    .slice(1, -1)
    .slice(0, 2)
    .map((p) => {
      const c = clampToStage(p, stage);
      return { x: r2(c.x), y: r2(c.y) };
    });
  if (turns.length) out.path = { kind: 'points', points: turns } satisfies PathSpec;
  return out;
}

export interface ApplyInput {
  mode: ApplyMode;
  formations: DetectedFormation[];
  tracks: Placed[];
  times: number[];
  mapping: (ID | null)[];
  recenter: boolean;
  snap: boolean;
  grid: boolean;
  paths: boolean;
  /** Each formation centred left-right (the formations given are already centred; positions mode centres here). */
  center: boolean;
}

export interface ApplyResult {
  message: string;
  anchors: GhostAnchor[];
}

/** How much each person moved between where they were seen and where they were put on the stage. */
function moves(raw: Vec[], applied: (Vec | undefined)[]) {
  return {
    dx: raw.map((p, k) => r2((applied[k]?.x ?? p.x) - p.x)),
    dy: raw.map((p, k) => r2((applied[k]?.y ?? p.y) - p.y)),
  };
}

/** Holds converted to the choreography clock, snapped to the beats, never overlapping. */
function choreoHolds(original: Choreo, formations: DetectedFormation[], snap: boolean) {
  const offset = original.video?.offset ?? 0;
  const music = original.music;
  const holds = formations.map((f) => ({ a: f.start - offset, b: f.end - offset, f })).filter((h) => h.b > 0.3);
  if (snap && music.bpm)
    for (const h of holds) {
      h.a = Math.max(0, snapTime(music, h.a));
      h.b = snapTime(music, h.b);
    }
  holds.forEach((h, i) => {
    const prev = holds[i - 1];
    if (!prev) h.a = 0;
    else {
      h.a = Math.max(h.a, prev.a + 0.5);
      if (prev.b > h.a - 0.25) prev.b = Math.max(prev.a + 0.25, h.a - 0.25);
      if (prev.b > h.a - 0.25) h.a = prev.b + 0.25;
    }
    h.b = Math.max(h.b, h.a + 0.25);
  });
  return holds.map((h) => ({ ...h, a: r2(h.a), b: r2(h.b) }));
}

/**
 * Writes the detection into the choreography (inside an editor update: one undo step).
 * Returns a short report and the anchors that line the ghosts up with what was written.
 */
export function applyDetection(draft: Choreo, original: Choreo, input: ApplyInput): ApplyResult {
  const { mapping, recenter, grid } = input;
  const holds = choreoHolds(original, input.formations, input.snap);
  const stage = original.stage;
  const anchors: GhostAnchor[] = [];
  const done = (message: string): ApplyResult => ({ message, anchors });

  if (input.mode === 'all') {
    if (!holds.length) return done('Aucune formation trouvée dans la vidéo');
    for (const id of Object.keys(draft.formations)) delete draft.formations[id];
    const dancers = sortedDancers(original);
    const placedBy: Map<ID, Vec>[] = [];
    holds.forEach((h, i) => {
      const at = computeFrame(original, h.a + 0.001);
      const mine = dancerPositions(h.f.positions, mapping, recenter, grid, stage);
      placedBy.push(mine);
      const raw = positionsOver(input.tracks, h.f.ranges);
      const shift = moves(raw, h.f.positions.map((p, k) => (mapping[k] ? (mine.get(mapping[k]!) ?? p) : p)));
      anchors.push({ t: h.a, v: h.f.start, ...shift }, { t: h.b, v: h.f.end, ...shift });
      const positions: Record<ID, Position> = {};
      for (const d of dancers) {
        const p = mine.get(d.id);
        if (!p) {
          const c = clampToStage(at.dancers[d.id] ?? { x: 0, y: 0 }, stage);
          positions[d.id] = { x: r2(c.x), y: r2(c.y) };
          continue;
        }
        positions[d.id] = { ...p };
        const k = mapping.indexOf(d.id);
        const prev = holds[i - 1];
        const before = placedBy[i - 1]?.get(d.id);
        if (input.paths && prev && before && k >= 0 && input.tracks[k]) {
          const fromIdx = prev.f.ranges[prev.f.ranges.length - 1][1];
          const toIdx = h.f.ranges[0][0];
          Object.assign(positions[d.id], routeFrom(input.tracks[k], fromIdx, toIdx, before, p, stage, input.times));
        }
      }
      const props: Choreo['formations'][string]['props'] = {};
      for (const pid in original.props) if (at.props[pid]) props[pid] = { ...at.props[pid] };
      const id = uid();
      draft.formations[id] = {
        id,
        name: `Formation ${i + 1}`,
        order: i,
        duration: r2(h.b - h.a),
        transition: i < holds.length - 1 ? r2(holds[i + 1].a - h.b) : 2,
        easing: input.paths ? 'linear' : 'ease',
        note: '',
        positions,
        props,
      };
    });
    return done(`${holds.length} formation${holds.length > 1 ? 's' : ''} créée${holds.length > 1 ? 's' : ''} d’après la vidéo`);
  }

  if (input.mode === 'positions') {
    const offset = original.video?.offset ?? 0;
    const { times, tracks } = input;
    let changed = 0;
    for (const it of timeline(original)) {
      const a = it.start + offset;
      const b = it.holdEnd + offset;
      let indices: number[] = [];
      for (let i = 0; i < times.length; i++) if (times[i] >= a && times[i] <= b) indices.push(i);
      if (!indices.length) {
        const mid = (a + b) / 2;
        if (mid < times[0] - 0.5 || mid > times[times.length - 1] + 0.5) continue;
        let best = 0;
        for (let i = 1; i < times.length; i++) if (Math.abs(times[i] - mid) < Math.abs(times[best] - mid)) best = i;
        indices = [best];
      }
      const raw = tracks.map((t) => ({ x: median(indices.map((i) => t.xs[i])), y: median(indices.map((i) => t.ys[i])) }));
      const positions = input.center ? centred(raw) : raw;
      const f = draft.formations[it.f.id];
      const mine = dancerPositions(positions, mapping, recenter, grid, stage);
      for (const [id, p] of mine) {
        if (!draft.dancers[id]) continue;
        f.positions[id] = { ...keepExtras(f.positions[id]), ...p };
      }
      const shift = moves(raw, positions.map((p, k) => (mapping[k] ? (mine.get(mapping[k]!) ?? p) : p)));
      anchors.push({ t: it.start, v: a, ...shift }, { t: it.holdEnd, v: b, ...shift });
      changed++;
    }
    return done(changed ? `Danseurs placés sur ${changed} formation${changed > 1 ? 's' : ''}` : 'La vidéo ne couvre pas vos formations (vérifiez le décalage)');
  }

  // timings: the formations keep their positions, their durations follow the video
  const list = sortedFormations(original);
  const k = Math.min(list.length, holds.length);
  for (let i = 0; i < k; i++) {
    const f = draft.formations[list[i].id];
    const h = holds[i];
    f.duration = r2(h.b - h.a);
    if (holds[i + 1]) f.transition = r2(holds[i + 1].a - h.b);
    // positions are the choreography's own: the ghosts only follow the new timings (and the centring)
    const shift = moves(positionsOver(input.tracks, h.f.ranges), h.f.positions);
    anchors.push({ t: h.a, v: h.f.start, ...shift }, { t: h.b, v: h.f.end, ...shift });
  }
  if (!k) return done('Aucune formation trouvée dans la vidéo');
  return done(
    holds.length === list.length
      ? `Timings calés sur ${k} formation${k > 1 ? 's' : ''}`
      : `Timings calés sur ${k} formation${k > 1 ? 's' : ''} (${holds.length} trouvée${holds.length > 1 ? 's' : ''} dans la vidéo, ${list.length} dans la choré)`,
  );
}

/** Where a ghost is at choreography time `t`: the video time to read, and how much to move each person. */
export function ghostAt(ghosts: Ghosts, t: number, offset: number): { v: number; dx: number[] | null; dy: number[] | null } {
  const anchors = ghosts.anchors;
  if (!anchors?.length) return { v: t + offset, dx: null, dy: null };
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (t <= first.t) return { v: first.v + (t - first.t), dx: first.dx, dy: first.dy };
  if (t >= last.t) return { v: last.v + (t - last.t), dx: last.dx, dy: last.dy };
  let j = 0;
  while (j < anchors.length - 2 && anchors[j + 1].t < t) j++;
  const a = anchors[j];
  const b = anchors[j + 1];
  const u = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
  return {
    v: a.v + (b.v - a.v) * u,
    dx: a.dx.map((d, k) => d + ((b.dx[k] ?? d) - d) * u),
    dy: a.dy.map((d, k) => d + ((b.dy[k] ?? d) - d) * u),
  };
}

/** The reviewed positions over time, in the colors of this choreography's dancers, lined up with what was applied. */
export function buildGhosts(an: Analysis, tracks: Placed[], mapping: (ID | null)[], dancers: Record<ID, Dancer>, anchors?: GhostAnchor[]): Ghosts {
  const start = an.times[0] ?? 0;
  const end = an.times[an.times.length - 1] ?? start;
  const count = Math.max(1, Math.round((end - start) * an.fps) + 1);
  // positions on an even grid of times (the analysed images are not evenly spaced)
  const resample = (values: Float32Array) => {
    const out: number[] = [];
    let j = 0;
    for (let k = 0; k < count; k++) {
      const t = start + k / an.fps;
      while (j < an.times.length - 2 && an.times[j + 1] <= t) j++;
      const span = an.times[j + 1] - an.times[j] || 1;
      const u = Math.max(0, Math.min(1, (t - an.times[j]) / span));
      out.push(r2(values[j] + (values[Math.min(j + 1, values.length - 1)] - values[j]) * u));
    }
    return out;
  };
  return {
    hash: an.hash,
    start,
    fps: an.fps,
    tracks: tracks.map((t, k) => ({
      color: (mapping[k] && dancers[mapping[k]!]?.color) || '#9b9ba7',
      xs: resample(t.xs),
      ys: resample(t.ys),
    })),
    ...(anchors?.length ? { anchors } : {}),
  };
}
