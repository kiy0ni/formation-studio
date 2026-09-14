import { r2 } from '../lib/geometry';
import { uid } from '../lib/id';
import { clampToStage, computeFrame, snapTime, sortedDancers, sortedFormations, timeline } from '../lib/model';
import type { Choreo, Dancer, ID, Position, StageSettings, Vec } from '../lib/types';
import type { Analysis, Ghosts, ReviewSettings, Swap } from './analysis';
import { median, percentile } from './floor';
import type { Track } from './track';

export type Placement = ReviewSettings['placement'];
export type Transform = ReviewSettings['transform'];
export type ApplyMode = ReviewSettings['mode'];

export const DEFAULT_PLACEMENT: Placement = { flip: false, spread: 1, depth: 1, fill: true };

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

/** Puts the group in the middle of the stage, at the chosen size. */
export function placeTracks(tracks: Track[], stage: StageSettings, placement: Placement): { tracks: Placed[]; transform: Transform } {
  const transform: Transform = { flip: placement.flip, spread: placement.spread, depth: placement.depth, ox: 0, oy: 0, s: 1 };
  const xs: number[] = [];
  const ys: number[] = [];
  for (const t of tracks)
    for (let i = 0; i < t.xs.length; i++) {
      if (!t.seen[i]) continue;
      const p = applyTransform(transform, { x: t.xs[i], y: t.ys[i] });
      xs.push(p.x);
      ys.push(p.y);
    }
  if (xs.length) {
    const x0 = percentile(xs, 0.03);
    const x1 = percentile(xs, 0.97);
    const y0 = percentile(ys, 0.03);
    const y1 = percentile(ys, 0.97);
    transform.ox = (x0 + x1) / 2;
    transform.oy = (y0 + y1) / 2;
    const fit = Math.min((stage.width * 0.85) / Math.max(0.5, x1 - x0), (stage.depth * 0.8) / Math.max(0.5, y1 - y0));
    transform.s = placement.fill ? Math.max(0.3, Math.min(2.5, fit)) : Math.min(1, fit);
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
export function groupSpeed(tracks: Placed[], fps: number, window: number) {
  const n = tracks[0]?.xs.length ?? 0;
  const w = Math.max(1, Math.round(fps * window));
  const top = Math.max(1, Math.ceil(tracks.length / 3));
  const speed = new Float32Array(n);
  const moving: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w);
    const b = Math.min(n - 1, i + w);
    const dt = (b - a) / fps || 1;
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
  const speed = groupSpeed(tracks, fps, tune.window);
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
    const lo = Math.max(a, calmest - 1);
    const hi = Math.min(b, calmest + 1);
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
  const pairs = people.length >= ds.length ? orderedMatch(people.map((p) => p.x), ds.map((d) => d.x)).map(([i, j]) => [i, j]) : orderedMatch(ds.map((d) => d.x), people.map((p) => p.x)).map(([j, i]) => [i, j]);
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

/** Positions of the chosen dancers; when fewer dancers than people, the kept ones can move back to the middle. */
function dancerPositions(positions: Vec[], mapping: (ID | null)[], recenter: boolean): Map<ID, Vec> {
  const mine = positions.map((p, k) => ({ p, id: mapping[k] })).filter((e): e is { p: Vec; id: ID } => !!e.id);
  let dx = 0;
  if (recenter && mine.length && mine.length < positions.length) {
    const all = positions.reduce((s, p) => s + p.x, 0) / positions.length;
    const kept = mine.reduce((s, e) => s + e.p.x, 0) / mine.length;
    dx = all - kept;
  }
  return new Map(mine.map((e) => [e.id, { x: e.p.x + dx, y: e.p.y }]));
}

const keepExtras = (old: Position | undefined): Partial<Position> => {
  const extra: Partial<Position> = {};
  if (old?.timing) extra.timing = old.timing;
  if (old?.comment) extra.comment = old.comment;
  return extra;
};

const onStage = (p: Vec, stage: StageSettings) => {
  const c = clampToStage(p, stage);
  return { x: r2(c.x), y: r2(c.y) };
};

export interface ApplyInput {
  mode: ApplyMode;
  formations: DetectedFormation[];
  tracks: Placed[];
  times: number[];
  mapping: (ID | null)[];
  recenter: boolean;
  snap: boolean;
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

/** Writes the detection into the choreography (inside an editor update: one undo step). Returns a short report. */
export function applyDetection(draft: Choreo, original: Choreo, input: ApplyInput): string {
  const { mapping, recenter } = input;
  const holds = choreoHolds(original, input.formations, input.snap);
  const stage = original.stage;

  if (input.mode === 'all') {
    if (!holds.length) return 'Aucune formation trouvée dans la vidéo';
    for (const id of Object.keys(draft.formations)) delete draft.formations[id];
    const dancers = sortedDancers(original);
    holds.forEach((h, i) => {
      const at = computeFrame(original, h.a + 0.001);
      const mine = dancerPositions(h.f.positions, mapping, recenter);
      const positions: Record<ID, Position> = {};
      for (const d of dancers) positions[d.id] = onStage(mine.get(d.id) ?? at.dancers[d.id] ?? { x: 0, y: 0 }, stage);
      const props: Choreo['formations'][string]['props'] = {};
      for (const pid in original.props) if (at.props[pid]) props[pid] = { ...at.props[pid] };
      const id = uid();
      draft.formations[id] = {
        id,
        name: `Formation ${i + 1}`,
        order: i,
        duration: r2(h.b - h.a),
        transition: i < holds.length - 1 ? r2(holds[i + 1].a - h.b) : 2,
        easing: 'ease',
        note: '',
        positions,
        props,
      };
    });
    return `${holds.length} formation${holds.length > 1 ? 's' : ''} créée${holds.length > 1 ? 's' : ''} d’après la vidéo`;
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
      const positions = tracks.map((t) => ({ x: median(indices.map((i) => t.xs[i])), y: median(indices.map((i) => t.ys[i])) }));
      const f = draft.formations[it.f.id];
      for (const [id, p] of dancerPositions(positions, mapping, recenter)) {
        if (!draft.dancers[id]) continue;
        f.positions[id] = { ...keepExtras(f.positions[id]), ...onStage(p, stage) };
      }
      changed++;
    }
    return changed ? `Danseurs placés sur ${changed} formation${changed > 1 ? 's' : ''}` : 'La vidéo ne couvre pas vos formations (vérifiez le décalage)';
  }

  // timings: the formations keep their positions, their durations follow the video
  const list = sortedFormations(original);
  const k = Math.min(list.length, holds.length);
  for (let i = 0; i < k; i++) {
    const f = draft.formations[list[i].id];
    const h = holds[i];
    f.duration = r2(h.b - h.a);
    if (holds[i + 1]) f.transition = r2(holds[i + 1].a - h.b);
  }
  if (!k) return 'Aucune formation trouvée dans la vidéo';
  return holds.length === list.length
    ? `Timings calés sur ${k} formation${k > 1 ? 's' : ''}`
    : `Timings calés sur ${k} formation${k > 1 ? 's' : ''} (${holds.length} trouvée${holds.length > 1 ? 's' : ''} dans la vidéo, ${list.length} dans la choré)`;
}

export function buildGhosts(an: Analysis, tracks: Placed[], mapping: (ID | null)[], dancers: Record<ID, Dancer>): Ghosts {
  return {
    hash: an.hash,
    start: an.times[0] ?? 0,
    fps: an.fps,
    tracks: tracks.map((t, k) => ({
      color: (mapping[k] && dancers[mapping[k]!]?.color) || '#9b9ba7',
      xs: Array.from(t.xs, r2),
      ys: Array.from(t.ys, r2),
    })),
  };
}
