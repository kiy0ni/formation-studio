import { centroid, clamp, r2, rotateAround } from './geometry';
import { clampToStage } from './model';
import { assignSlots, fitLayout, PRESET_BY_ID, type AssignMode } from './presets';
import type { Choreo, ID, Vec } from './types';

export interface PresetOptions {
  spacing: number;
  mode: AssignMode;
  keepCenter: boolean;
}

export function applyPreset(draft: Choreo, fid: ID, presetId: string, ids: ID[], opts: PresetOptions) {
  const f = draft.formations[fid];
  const preset = PRESET_BY_ID[presetId];
  if (!f || !preset || !ids.length) return;
  const current = ids.map((id) => f.positions[id] ?? { x: 0, y: 0 });
  const center = opts.keepCenter && ids.length < Object.keys(draft.dancers).length ? centroid(current) : { x: 0, y: 0 };
  const slots = fitLayout(preset.generate(ids.length, opts.spacing), draft.stage, center);
  const map = assignSlots(ids, current, slots, opts.mode);
  for (const id of ids) {
    const prev = f.positions[id];
    f.positions[id] = { x: map[id].x, y: map[id].y, ...(prev?.comment ? { comment: prev.comment } : {}), ...(prev?.timing ? { timing: prev.timing } : {}) };
  }
}

export type TransformKind =
  | 'mirrorX'
  | 'mirrorY'
  | 'rotateL'
  | 'rotateR'
  | 'spread'
  | 'tighten'
  | 'alignH'
  | 'alignV'
  | 'distH'
  | 'distV'
  | 'center'
  | 'snap';

export function transform(draft: Choreo, fid: ID, ids: ID[], kind: TransformKind) {
  const f = draft.formations[fid];
  if (!f || !ids.length) return;
  const pts = ids.map((id) => f.positions[id]).filter(Boolean);
  if (!pts.length) return;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const box = { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const c = centroid(pts);
  const set = (id: ID, v: Vec) => {
    const p = f.positions[id];
    const cl = clampToStage(v, draft.stage);
    p.x = r2(cl.x);
    p.y = r2(cl.y);
    delete p.path;
  };
  switch (kind) {
    case 'mirrorX':
      ids.forEach((id) => set(id, { x: -f.positions[id].x, y: f.positions[id].y }));
      break;
    case 'mirrorY':
      ids.forEach((id) => set(id, { x: f.positions[id].x, y: 2 * box.cy - f.positions[id].y }));
      break;
    case 'rotateL':
    case 'rotateR':
      ids.forEach((id) => set(id, rotateAround(f.positions[id], c, kind === 'rotateL' ? -15 : 15)));
      break;
    case 'spread':
    case 'tighten': {
      const k = kind === 'spread' ? 1.15 : 1 / 1.15;
      ids.forEach((id) => set(id, { x: c.x + (f.positions[id].x - c.x) * k, y: c.y + (f.positions[id].y - c.y) * k }));
      break;
    }
    case 'alignH':
      ids.forEach((id) => set(id, { x: f.positions[id].x, y: c.y }));
      break;
    case 'alignV':
      ids.forEach((id) => set(id, { x: c.x, y: f.positions[id].y }));
      break;
    case 'distH':
    case 'distV': {
      if (ids.length < 3) break;
      const axis = kind === 'distH' ? 'x' : 'y';
      const sorted = [...ids].sort((a, b) => f.positions[a][axis] - f.positions[b][axis]);
      const lo = f.positions[sorted[0]][axis];
      const hi = f.positions[sorted[sorted.length - 1]][axis];
      sorted.forEach((id, i) => {
        const v = lo + ((hi - lo) * i) / (sorted.length - 1);
        set(id, axis === 'x' ? { x: v, y: f.positions[id].y } : { x: f.positions[id].x, y: v });
      });
      break;
    }
    case 'center': {
      const dx = -box.cx;
      ids.forEach((id) => set(id, { x: f.positions[id].x + dx, y: f.positions[id].y }));
      break;
    }
    case 'snap': {
      const s = draft.stage.gridStep || 0.5;
      ids.forEach((id) => set(id, { x: Math.round(f.positions[id].x / s) * s, y: Math.round(f.positions[id].y / s) * s }));
      break;
    }
  }
}

/** Canon: dancers start moving one after another during the incoming transition. */
export function stagger(draft: Choreo, fid: ID, ids: ID[], direction: 'ltr' | 'rtl' | 'frontBack' | 'order' | 'reset', overlap = 0.5) {
  const f = draft.formations[fid];
  if (!f) return;
  if (direction === 'reset') {
    ids.forEach((id) => f.positions[id] && delete f.positions[id].timing);
    return;
  }
  const order = [...ids];
  if (direction === 'ltr') order.sort((a, b) => f.positions[a].x - f.positions[b].x);
  if (direction === 'rtl') order.sort((a, b) => f.positions[b].x - f.positions[a].x);
  if (direction === 'frontBack') order.sort((a, b) => f.positions[b].y - f.positions[a].y);
  if (direction === 'order') order.sort((a, b) => (draft.dancers[a]?.order ?? 0) - (draft.dancers[b]?.order ?? 0));
  const n = order.length;
  if (n < 2) return;
  const len = clamp(1 / (n - (n - 1) * overlap), 0.05, 1);
  const step = (1 - len) / (n - 1);
  order.forEach((id, i) => {
    if (f.positions[id]) f.positions[id].timing = { start: r2(i * step), end: r2(i * step + len) };
  });
}

export function swap(draft: Choreo, fid: ID, a: ID, b: ID) {
  const f = draft.formations[fid];
  if (!f?.positions[a] || !f.positions[b]) return;
  const pa = { x: f.positions[a].x, y: f.positions[a].y };
  f.positions[a].x = f.positions[b].x;
  f.positions[a].y = f.positions[b].y;
  f.positions[b].x = pa.x;
  f.positions[b].y = pa.y;
  delete f.positions[a].path;
  delete f.positions[b].path;
}
