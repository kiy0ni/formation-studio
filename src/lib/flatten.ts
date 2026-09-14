import type { Choreo, Formation } from './types';

/**
 * A choreography is synced and undone as a flat map of independent keys, so that
 * two people editing different dancers / formations never overwrite each other.
 *
 *   meta            { name }
 *   stage           StageSettings
 *   music           MusicInfo
 *   video           RefVideo settings (the video file itself stays on each device)
 *   d:<id>          Dancer
 *   p:<id>          Prop
 *   f:<id>          Formation fields (without positions / props)
 *   pos:<fid>:<did> Position
 *   ps:<fid>:<pid>  PropState
 */
export type Flat = Record<string, unknown>;
export type Patch = Record<string, unknown | null>;

const metaCache = new WeakMap<Formation, object>();

function formationMeta(f: Formation) {
  let m = metaCache.get(f);
  if (!m) {
    const { positions: _p, props: _s, ...rest } = f;
    m = rest;
    metaCache.set(f, m);
  }
  return m;
}

export function flatten(doc: Choreo): Flat {
  const out: Flat = { meta: { name: doc.name }, stage: doc.stage, music: doc.music };
  if (doc.video) out.video = doc.video;
  for (const id in doc.dancers) out[`d:${id}`] = doc.dancers[id];
  for (const id in doc.props) out[`p:${id}`] = doc.props[id];
  for (const fid in doc.formations) {
    const f = doc.formations[fid];
    out[`f:${fid}`] = formationMeta(f);
    for (const did in f.positions) out[`pos:${fid}:${did}`] = f.positions[did];
    for (const pid in f.props) out[`ps:${fid}:${pid}`] = f.props[pid];
  }
  return out;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Returns the changed keys: { before, after } (null = absent). */
export function diff(a: Flat, b: Flat): { before: Patch; after: Patch } | null {
  const before: Patch = {};
  const after: Patch = {};
  let changed = false;
  for (const k in b) {
    if (!same(a[k], b[k])) {
      before[k] = a[k] ?? null;
      after[k] = b[k];
      changed = true;
    }
  }
  for (const k in a) {
    if (!(k in b)) {
      before[k] = a[k];
      after[k] = null;
      changed = true;
    }
  }
  return changed ? { before, after } : null;
}

const rank = (k: string) => (k.startsWith('pos:') || k.startsWith('ps:') ? 1 : 0);

/** Applies a patch onto a mutable (immer draft) choreography. */
export function applyPatch(draft: Choreo, patch: Patch) {
  const keys = Object.keys(patch).sort((a, b) => rank(a) - rank(b));
  for (const k of keys) {
    const v = patch[k] as any;
    const clone = v == null ? v : structuredClone(v);
    if (k === 'meta') {
      if (clone) draft.name = clone.name;
    } else if (k === 'stage') {
      if (clone) draft.stage = clone;
    } else if (k === 'music') {
      if (clone) draft.music = clone;
    } else if (k === 'video') {
      draft.video = clone ?? null;
    } else if (k.startsWith('d:')) {
      const id = k.slice(2);
      if (clone) draft.dancers[id] = clone;
      else delete draft.dancers[id];
    } else if (k.startsWith('p:')) {
      const id = k.slice(2);
      if (clone) draft.props[id] = clone;
      else delete draft.props[id];
    } else if (k.startsWith('f:')) {
      const id = k.slice(2);
      if (!clone) delete draft.formations[id];
      else if (draft.formations[id]) Object.assign(draft.formations[id], clone);
      else draft.formations[id] = { ...clone, positions: {}, props: {} };
    } else if (k.startsWith('pos:') || k.startsWith('ps:')) {
      const [kind, fid, sub] = k.split(':');
      const f = draft.formations[fid];
      if (!f) continue;
      const bag = kind === 'pos' ? f.positions : f.props;
      if (clone) bag[sub] = clone;
      else delete bag[sub];
    }
  }
}

export function unflatten(base: Pick<Choreo, 'id' | 'createdAt' | 'updatedAt'>, flat: Flat): Choreo {
  const doc: Choreo = {
    ...base,
    name: 'Chorégraphie partagée',
    stage: undefined as any,
    music: {},
    dancers: {},
    formations: {},
    props: {},
  };
  applyPatch(doc, flat);
  return doc;
}
