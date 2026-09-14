import type { Analysis, Det } from './analysis';
import { median, toFloor, type FloorModel } from './floor';
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
}

/** A stretch where we are sure it is the same person (nobody else close). */
interface Piece {
  idx: number[];
  xs: number[];
  ys: number[];
  det: number[];
  looks: number[][];
  /** Looks measured while standing apart from everyone (more reliable). */
  clean: number;
  sig: number[];
  lx: number;
  ly: number;
}

interface Person {
  xs: Float64Array;
  ys: Float64Array;
  det: Int16Array;
  sig: number[];
  weight: number;
  /** Look fixed after the first round, to judge the second one. */
  ref: number[];
}

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

/**
 * 1. Short sure stretches: a stretch stops as soon as two people get close (crossings are where mix-ups happen).
 * 2. The stretches are joined into people by their look (hair, top, pants, shoes), then by where they could be.
 */
export function trackPeople(an: Analysis, floor: FloorModel, people?: number): Tracking {
  const n = an.times.length;
  const fps = an.fps;
  const suggested = suggestedPeople(an);
  const target = Math.max(1, Math.round(people || suggested));

  /* ---------- 1. sure stretches ---------- */
  const pieces: Piece[] = [];
  let active: (Piece & { last: number })[] = [];
  const start = (i: number, e: { d: Det; k: number; p: { x: number; y: number }; crowded: boolean }) => {
    const piece = { idx: [], xs: [], ys: [], det: [], looks: [], clean: 0, sig: [], lx: 0, ly: 0, last: i } as Piece & { last: number };
    extend(piece, i, e);
    pieces.push(piece);
    return piece;
  };
  const extend = (t: Piece & { last: number }, i: number, e: { d: Det; k: number; p: { x: number; y: number }; crowded: boolean }) => {
    t.idx.push(i);
    t.xs.push(e.p.x);
    t.ys.push(e.p.y);
    t.det.push(e.k);
    t.lx = e.p.x;
    t.ly = e.p.y;
    t.last = i;
    if (e.d.sig.length && e.d.s >= 0.35) {
      if (!e.crowded) t.clean++;
      if (!e.crowded || t.clean === 0) t.looks.push(e.d.sig);
    }
  };

  for (let i = 0; i < n; i++) {
    const frame = an.frames[i];
    const dets = frame
      .map((d, k) => ({ d, k, p: toFloor(floor, d), crowded: frame.some((o, j) => j !== k && covered(d, o) > 0.25) }))
      .filter((e) => e.d.s >= 0.25);
    active = active.filter((t) => i - t.last <= 3);
    const pairs: { t: (typeof active)[number]; e: (typeof dets)[number]; dist: number }[] = [];
    for (const t of active) {
      const gate = 0.45 + 1.8 * ((i - t.last) / fps);
      for (const e of dets) {
        const dist = Math.hypot(e.p.x - t.lx, e.p.y - t.ly);
        if (dist <= gate) pairs.push({ t, e, dist });
      }
    }
    pairs.sort((a, b) => a.dist - b.dist);
    const usedT = new Set<Piece>();
    const usedE = new Set<number>();
    const next: typeof active = [];
    for (const { t, e, dist } of pairs) {
      if (usedT.has(t) || usedE.has(e.k)) continue;
      usedT.add(t);
      usedE.add(e.k);
      const margin = Math.max(0.5, dist * 1.6);
      const unsure = dets.some((o) => o !== e && Math.hypot(o.p.x - t.lx, o.p.y - t.ly) < margin) || active.some((o) => o !== t && Math.hypot(e.p.x - o.lx, e.p.y - o.ly) < margin);
      if (unsure) next.push(start(i, e) as Piece & { last: number });
      else {
        extend(t, i, e);
        next.push(t);
      }
    }
    for (const e of dets) {
      if (usedE.has(e.k) || e.d.s < 0.3) continue;
      if (dets.some((o) => o !== e && usedE.has(o.k) && Math.hypot(o.p.x - e.p.x, o.p.y - e.p.y) < 0.3)) continue;
      usedE.add(e.k);
      next.push(start(i, e) as Piece & { last: number });
    }
    // stretches not seen on this image stay open a little (someone hidden for a moment)
    for (const t of active) if (!usedT.has(t) && !next.includes(t)) next.push(t);
    active = next;
  }
  for (const p of pieces) p.sig = meanSignature(p.looks);

  /* ---------- 2. join stretches into people ---------- */
  const usable = pieces.filter((p) => p.idx.length >= 2);
  const len = (p: Piece) => p.idx.length;
  const first = (p: Piece) => p.idx[0];
  const last = (p: Piece) => p.idx[p.idx.length - 1];

  // start from the moment most people are seen for a long time, all at once (surely different people)
  let seeds: Piece[] = [];
  let bestScore = -1;
  for (let i = 0; i < n; i += 1) {
    const here = usable.filter((p) => first(p) <= i && last(p) >= i).sort((a, b) => len(b) - len(a)).slice(0, target);
    if (!here.length) continue;
    const score = here.length * 10000 + Math.min(...here.map(len));
    if (score > bestScore) {
      bestScore = score;
      seeds = here;
    }
  }

  const newPerson = (p: Piece): Person => {
    const person: Person = { xs: new Float64Array(n).fill(NaN), ys: new Float64Array(n).fill(NaN), det: new Int16Array(n).fill(-1), sig: p.sig, weight: 0, ref: p.sig };
    assign(person, p);
    return person;
  };
  const assign = (person: Person, p: Piece) => {
    p.idx.forEach((i, k) => {
      person.xs[i] = p.xs[k];
      person.ys[i] = p.ys[k];
      person.det[i] = p.det[k];
    });
    const w = Math.max(1, p.clean);
    person.sig = meanSignature([person.sig, p.sig], [person.weight, w]);
    person.weight += w;
  };
  const free = (person: Person, p: Piece) => {
    let clash = 0;
    for (const i of p.idx) if (person.det[i] >= 0 && ++clash > 1) return false;
    return true;
  };
  /** Could this person walk to the start of the stretch and from its end, in the time available? */
  const reach = (person: Person, p: Piece) => {
    let cost = 0;
    let checks = 0;
    const check = (i: number, k: number) => {
      const gap = Math.abs(p.idx[k] - i) / fps;
      const allowed = Math.min(8, 1 + 2.5 * gap);
      const d = Math.hypot(person.xs[i] - p.xs[k], person.ys[i] - p.ys[k]);
      if (d > allowed) return false;
      cost += d / allowed;
      checks++;
      return true;
    };
    let before = first(p) - 1;
    while (before >= 0 && person.det[before] < 0) before--;
    if (before >= 0 && !check(before, 0)) return Infinity;
    let after = last(p) + 1;
    while (after < n && person.det[after] < 0) after++;
    if (after < n && !check(after, p.idx.length - 1)) return Infinity;
    return checks ? cost / checks : 0.6;
  };

  const rest = usable.filter((p) => !seeds.includes(p)).sort((a, b) => len(b) - len(a));
  let persons: Person[] = [];
  for (let round = 0; round < 2; round++) {
    const refs = persons.map((p) => p.sig);
    persons = seeds.map((s, k) => {
      const person = newPerson(s);
      if (round === 1 && refs[k]) person.ref = refs[k];
      return person;
    });
    for (const p of rest) {
      let best: Person | null = null;
      let bestCost = Infinity;
      for (const person of persons) {
        if (!free(person, p)) continue;
        const r = reach(person, p);
        if (!Number.isFinite(r)) continue;
        const look = round === 1 ? sigDistance(person.ref, p.sig) : sigDistance(person.sig, p.sig);
        const cost = 2 * look + 0.6 * r;
        if (cost < bestCost) {
          bestCost = cost;
          best = person;
        }
      }
      if (persons.length < target && (bestCost > 1.1 || !best) && len(p) >= 2 * fps) {
        persons.push(newPerson(p));
        continue;
      }
      if (best && bestCost <= 2) assign(best, p);
    }
  }

  const out: Track[] = persons.map((person) => ({
    xs: smooth(fill(person.xs)),
    ys: smooth(fill(person.ys)),
    seen: Uint8Array.from(person.det, (v) => (v >= 0 ? 1 : 0)),
    det: person.det,
    sig: person.sig,
  }));
  out.sort((a, b) => median(a.xs) - median(b.xs));
  return { people: target, suggested, tracks: out };
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
  for (const kf of an.keyframes) {
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

/** Pictures of a person through the video (checking the tracking). */
export function crops(an: Analysis, track: Track, count: number) {
  const seen = an.keyframes.filter((kf) => track.det[kf.index] >= 0);
  const step = Math.max(1, seen.length / count);
  const out: { url: string; time: number; box: Det }[] = [];
  for (let i = 0; i < seen.length && out.length < count; i += step) {
    const kf = seen[Math.floor(i)];
    out.push({ url: kf.url, time: an.times[kf.index], box: an.frames[kf.index][track.det[kf.index]] });
  }
  return out;
}
