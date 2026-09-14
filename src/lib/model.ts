import { pickColor } from './colors';
import { clamp, dist, ease, lerp, lerpColor, pointOnPath, r2 } from './geometry';
import { uid } from './id';
import type {
  Choreo,
  Dancer,
  Formation,
  Frame,
  ID,
  MusicInfo,
  Prop,
  PropShape,
  PropState,
  StageSettings,
  TeamMember,
  Vec,
} from './types';

export function defaultStage(): StageSettings {
  return {
    width: 10,
    depth: 8,
    wingWidth: 1.5,
    backstageDepth: 1,
    gridStep: 0.5,
    showGrid: true,
    showNumbers: true,
    snap: true,
    dancerSize: 0.55,
    floorColor: '#1b1726',
  };
}

export const STAGE_PRESETS: { label: string; width: number; depth: number }[] = [
  { label: 'Salle de répét (8×6)', width: 8, depth: 6 },
  { label: 'Scène standard (10×8)', width: 10, depth: 8 },
  { label: 'Grande scène (14×10)', width: 14, depth: 10 },
  { label: 'Plateau émission (12×9)', width: 12, depth: 9 },
  { label: 'Cover extérieur (16×12)', width: 16, depth: 12 },
];

export function defaultMembers(n: number): TeamMember[] {
  return Array.from({ length: n }, (_, i) => ({ name: `Membre ${i + 1}`, color: pickColor(i) }));
}

export const sortedDancers = (doc: Choreo): Dancer[] =>
  Object.values(doc.dancers).sort((a, b) => a.order - b.order);
export const sortedFormations = (doc: Choreo): Formation[] =>
  Object.values(doc.formations).sort((a, b) => a.order - b.order);
export const sortedProps = (doc: Choreo): Prop[] => Object.values(doc.props).sort((a, b) => a.order - b.order);

export interface TimelineItem {
  f: Formation;
  index: number;
  start: number;
  holdEnd: number;
  end: number;
}

const tlCache = new WeakMap<Record<ID, Formation>, TimelineItem[]>();

export function timeline(doc: Choreo): TimelineItem[] {
  const cached = tlCache.get(doc.formations);
  if (cached) return cached;
  const list = sortedFormations(doc);
  let t = 0;
  const items = list.map((f, index) => {
    const start = t;
    const holdEnd = start + f.duration;
    const end = index === list.length - 1 ? holdEnd : holdEnd + f.transition;
    t = end;
    return { f, index, start, holdEnd, end };
  });
  tlCache.set(doc.formations, items);
  return items;
}

export function totalDuration(doc: Choreo): number {
  const items = timeline(doc);
  const end = items.length ? items[items.length - 1].end : 0;
  return Math.max(end, doc.music.duration ?? 0);
}

export function itemIndexAt(items: TimelineItem[], t: number): number {
  if (!items.length) return -1;
  for (let i = items.length - 1; i >= 0; i--) if (t >= items[i].start) return i;
  return 0;
}

export function dancerPosAt(from: Formation, to: Formation | undefined, dancerId: ID, progress: number): Vec {
  const a = from.positions[dancerId] ?? { x: 0, y: 0 };
  if (!to || progress <= 0) return { x: a.x, y: a.y };
  const b = to.positions[dancerId] ?? a;
  const win = b.timing ?? { start: 0, end: 1 };
  const span = Math.max(0.0001, win.end - win.start);
  const local = clamp((progress - win.start) / span, 0, 1);
  return pointOnPath(a, b, b.path, ease(from.easing, local));
}

function propAt(from: PropState | undefined, to: PropState | undefined, p: number): PropState | undefined {
  if (!from) return to;
  if (!to || p <= 0) return from;
  return {
    x: lerp(from.x, to.x, p),
    y: lerp(from.y, to.y, p),
    w: lerp(from.w, to.w, p),
    h: lerp(from.h, to.h, p),
    rotation: lerp(from.rotation, to.rotation, p),
    color: lerpColor(from.color, to.color, p),
    visible: p < 0.5 ? from.visible : to.visible,
  };
}

export function computeFrame(doc: Choreo, time: number): Frame {
  const items = timeline(doc);
  const frame: Frame = { time, index: 0, progress: 0, inTransition: false, dancers: {}, props: {} };
  if (!items.length) return frame;
  const i = itemIndexAt(items, time);
  const it = items[i];
  const next = items[i + 1];
  let progress = 0;
  if (next && time > it.holdEnd && it.f.transition > 0) {
    progress = clamp((time - it.holdEnd) / it.f.transition, 0, 1);
  }
  frame.index = i;
  frame.progress = progress;
  frame.inTransition = progress > 0 && progress < 1;
  const toF = next?.f;
  for (const id in doc.dancers) frame.dancers[id] = dancerPosAt(it.f, toF, id, progress);
  const eased = ease(it.f.easing, progress);
  for (const id in doc.props) {
    const s = propAt(it.f.props[id], toF?.props[id], eased);
    if (s) frame.props[id] = s;
  }
  return frame;
}

export interface Collision {
  a: ID;
  b: ID;
  time: number;
  index: number;
  kind: 'formation' | 'transition';
}

export function findCollisions(doc: Choreo): Collision[] {
  const items = timeline(doc);
  const ids = Object.keys(doc.dancers);
  const min = doc.stage.dancerSize * 0.85;
  const out: Collision[] = [];
  const seen = new Set<string>();
  items.forEach((it, idx) => {
    const next = items[idx + 1];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const pa = it.f.positions[ids[i]];
        const pb = it.f.positions[ids[j]];
        if (pa && pb && dist(pa, pb) < min) {
          out.push({ a: ids[i], b: ids[j], time: it.start, index: idx, kind: 'formation' });
          seen.add(`${idx}:${ids[i]}:${ids[j]}`);
        }
      }
    if (!next || it.f.transition <= 0) return;
    const steps = Math.max(12, Math.round(it.f.transition * 20));
    for (let s = 1; s < steps; s++) {
      const p = s / steps;
      const pos = ids.map((id) => dancerPosAt(it.f, next.f, id, p));
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const key = `${idx}:${ids[i]}:${ids[j]}`;
          if (seen.has(key)) continue;
          if (dist(pos[i], pos[j]) < min) {
            seen.add(key);
            out.push({ a: ids[i], b: ids[j], time: it.holdEnd + p * it.f.transition, index: idx, kind: 'transition' });
          }
        }
    }
  });
  return out;
}

export function stageBounds(stage: StageSettings) {
  return {
    minX: -stage.width / 2 - stage.wingWidth,
    maxX: stage.width / 2 + stage.wingWidth,
    minY: -stage.depth / 2 - stage.backstageDepth,
    maxY: stage.depth / 2,
  };
}

export function clampToStage(p: Vec, stage: StageSettings): Vec {
  const b = stageBounds(stage);
  return { x: clamp(p.x, b.minX, b.maxX), y: clamp(p.y, b.minY, b.maxY) };
}

export function snapVec(p: Vec, stage: StageSettings): Vec {
  if (!stage.snap || stage.gridStep <= 0) return { x: r2(p.x), y: r2(p.y) };
  const s = stage.gridStep / 2;
  return { x: r2(Math.round(p.x / s) * s), y: r2(Math.round(p.y / s) * s) };
}

function lineSlots(n: number, stage: StageSettings): Vec[] {
  const spacing = Math.min(1.2, (stage.width * 0.9) / Math.max(1, n));
  return Array.from({ length: n }, (_, i) => ({ x: r2((i - (n - 1) / 2) * spacing), y: 0 }));
}

export function createChoreo(opts: {
  name: string;
  members: TeamMember[];
  stage?: Partial<StageSettings>;
  folderId?: ID | null;
}): Choreo {
  const stage = { ...defaultStage(), ...opts.stage };
  const now = Date.now();
  const dancers: Record<ID, Dancer> = {};
  const slots = lineSlots(opts.members.length, stage);
  const positions: Record<ID, { x: number; y: number }> = {};
  opts.members.forEach((m, i) => {
    const id = uid();
    dancers[id] = { id, name: m.name, color: m.color, group: m.group, order: i };
    positions[id] = slots[i];
  });
  const f: Formation = {
    id: uid(),
    name: 'Intro',
    order: 0,
    duration: 4,
    transition: 2,
    easing: 'ease',
    note: '',
    positions,
    props: {},
  };
  return {
    id: uid(),
    name: opts.name || 'Nouvelle chorégraphie',
    createdAt: now,
    updatedAt: now,
    folderId: opts.folderId ?? null,
    stage,
    music: { countsPerPhrase: 8 },
    dancers,
    formations: { [f.id]: f },
    props: {},
  };
}

/** Inserts a copy of `afterId` right after it. Returns the new formation id. */
export function insertFormationAfter(draft: Choreo, afterId: ID | null, name?: string): ID {
  const list = sortedFormations(draft);
  const idx = afterId ? list.findIndex((f) => f.id === afterId) : list.length - 1;
  const src = list[idx] ?? list[list.length - 1];
  const next = list[idx + 1];
  const order = src ? (next ? (src.order + next.order) / 2 : src.order + 1) : 0;
  const id = uid();
  const positions: Formation['positions'] = {};
  if (src) for (const d in src.positions) positions[d] = { x: src.positions[d].x, y: src.positions[d].y };
  const props: Formation['props'] = {};
  if (src) for (const p in src.props) props[p] = { ...src.props[p] };
  draft.formations[id] = {
    id,
    name: name ?? `Formation ${list.length + 1}`,
    order,
    duration: src?.duration ?? 4,
    transition: src?.transition ?? 2,
    easing: src?.easing ?? 'ease',
    note: '',
    positions,
    props,
  };
  return id;
}

export function removeFormation(draft: Choreo, id: ID) {
  if (Object.keys(draft.formations).length <= 1) return;
  delete draft.formations[id];
}

export function moveFormation(draft: Choreo, id: ID, dir: -1 | 1) {
  const list = sortedFormations(draft);
  const i = list.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = draft.formations[list[i].id];
  const b = draft.formations[list[j].id];
  const tmp = a.order;
  a.order = b.order;
  b.order = tmp;
}

function freeSpot(existing: Vec[], stage: StageSettings): Vec {
  const step = Math.max(0.5, stage.gridStep);
  for (let row = 0; row < 20; row++) {
    const y = r2(stage.depth / 2 - 0.8 - row * step * 2);
    for (let k = 0; k < 40; k++) {
      const x = r2((k % 2 ? 1 : -1) * Math.ceil(k / 2) * step * 2);
      if (Math.abs(x) > stage.width / 2) break;
      const p = { x, y };
      if (existing.every((e) => dist(e, p) > stage.dancerSize * 1.4)) return p;
    }
  }
  return { x: 0, y: 0 };
}

export function addDancer(draft: Choreo, member?: Partial<TeamMember>): ID {
  const list = sortedDancers(draft);
  const id = uid();
  const n = list.length;
  draft.dancers[id] = {
    id,
    name: member?.name ?? `Membre ${n + 1}`,
    color: member?.color ?? pickColor(n),
    group: member?.group,
    order: n ? list[n - 1].order + 1 : 0,
  };
  for (const f of Object.values(draft.formations)) {
    f.positions[id] = freeSpot(Object.values(f.positions), draft.stage);
  }
  return id;
}

export function removeDancer(draft: Choreo, id: ID) {
  delete draft.dancers[id];
  for (const f of Object.values(draft.formations)) delete f.positions[id];
}

export function addProp(draft: Choreo, shape: PropShape, name?: string): ID {
  const list = sortedProps(draft);
  const id = uid();
  draft.props[id] = {
    id,
    name: name ?? (shape === 'rect' ? 'Accessoire' : 'Rond'),
    shape,
    order: list.length ? list[list.length - 1].order + 1 : 0,
  };
  const state: PropState = {
    x: 0,
    y: -draft.stage.depth / 2 + 1,
    w: shape === 'rect' ? 1.6 : 1,
    h: shape === 'rect' ? 0.6 : 1,
    rotation: 0,
    color: '#8b7355',
    visible: true,
  };
  for (const f of Object.values(draft.formations)) f.props[id] = { ...state };
  return id;
}

export function removeProp(draft: Choreo, id: ID) {
  delete draft.props[id];
  for (const f of Object.values(draft.formations)) delete f.props[id];
}

/* ---------------------------------- Music --------------------------------- */

export function beatLength(music: MusicInfo): number | null {
  return music.bpm && music.bpm > 0 ? 60 / music.bpm : null;
}

export function snapTime(music: MusicInfo, t: number, subdivision = 2): number {
  const bl = beatLength(music);
  if (!bl) return r2(t);
  const step = bl / subdivision;
  const off = music.beatOffset ?? 0;
  return r2(Math.round((t - off) / step) * step + off);
}

export function countAt(music: MusicInfo, t: number): { phrase: number; count: number; beat: number } | null {
  const bl = beatLength(music);
  if (!bl) return null;
  const beat = Math.floor((t - (music.beatOffset ?? 0)) / bl + 1e-6);
  if (beat < 0) return null;
  const per = music.countsPerPhrase || 8;
  return { phrase: Math.floor(beat / per) + 1, count: (beat % per) + 1, beat };
}

export function formatTime(t: number, precise = true): string {
  const sign = t < 0 ? '-' : '';
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return precise ? `${sign}${m}:${s.toFixed(2).padStart(5, '0')}` : `${sign}${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}
