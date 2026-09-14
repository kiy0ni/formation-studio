import { produce, freeze } from 'immer';
import { create } from 'zustand';
import { applyPatch, diff, flatten, type Flat, type Patch } from '../lib/flatten';
import { itemIndexAt, timeline, totalDuration } from '../lib/model';
import type { Choreo, ID } from '../lib/types';

interface HistoryEntry {
  label: string;
  before: Patch;
  after: Patch;
}

export type InspectorTab = 'formation' | 'dancers' | 'presets' | 'stage' | 'props' | 'music';

export interface EditorState {
  doc: Choreo | null;
  flat: Flat;
  past: HistoryEntry[];
  future: HistoryEntry[];
  gesture: { label: string; base: Flat } | null;
  readOnly: boolean;

  time: number;
  playing: boolean;
  rate: number;
  loop: { a: number; b: number } | null;
  metronome: boolean;

  selected: ID[];
  selectedProp: ID | null;
  view: '2d' | '3d';
  audienceTop: boolean;
  showPaths: boolean;
  showGhost: boolean;
  showNames: boolean;
  focusDancer: ID | null;
  tab: InspectorTab;
  pxPerSec: number;
  toast: { text: string; id: number } | null;

  load: (doc: Choreo, readOnly?: boolean) => void;
  unload: () => void;
  update: (label: string, fn: (draft: Choreo) => void) => void;
  beginGesture: (label: string) => void;
  endGesture: () => void;
  undo: () => void;
  redo: () => void;
  applyRemote: (patch: Patch) => void;

  setTime: (t: number) => void;
  select: (ids: ID[]) => void;
  set: (partial: Partial<EditorState>) => void;
  notify: (text: string) => void;
}

type LocalListener = (after: Patch) => void;
const localListeners = new Set<LocalListener>();
export const onLocalChange = (fn: LocalListener) => {
  localListeners.add(fn);
  return () => localListeners.delete(fn);
};
const emit = (p: Patch) => localListeners.forEach((fn) => fn(p));

const MAX_HISTORY = 300;

export const useEditor = create<EditorState>((set, get) => ({
  doc: null,
  flat: {},
  past: [],
  future: [],
  gesture: null,
  readOnly: false,

  time: 0,
  playing: false,
  rate: 1,
  loop: null,
  metronome: false,

  selected: [],
  selectedProp: null,
  view: '2d',
  audienceTop: false,
  showPaths: true,
  showGhost: true,
  showNames: true,
  focusDancer: null,
  tab: 'presets',
  pxPerSec: 60,
  toast: null,

  load: (doc, readOnly = false) => {
    const frozen = freeze(structuredClone(doc), true);
    set({
      doc: frozen,
      flat: flatten(frozen),
      past: [],
      future: [],
      gesture: null,
      readOnly,
      time: 0,
      playing: false,
      selected: [],
      selectedProp: null,
      focusDancer: null,
      loop: null,
    });
  },

  unload: () => set({ doc: null, flat: {}, past: [], future: [], playing: false }),

  update: (label, fn) => {
    const { doc, flat, gesture, readOnly } = get();
    if (!doc || readOnly) return;
    const next = produce(doc, (d) => {
      fn(d);
    });
    if (next === doc) return;
    const nextFlat = flatten(next);
    const d = diff(flat, nextFlat);
    if (!d) return;
    const stamped = produce(next, (x) => {
      x.updatedAt = Date.now();
    });
    if (gesture) {
      set({ doc: stamped, flat: nextFlat });
    } else {
      set((s) => ({
        doc: stamped,
        flat: nextFlat,
        past: [...s.past.slice(-MAX_HISTORY + 1), { label, ...d }],
        future: [],
      }));
    }
    emit(d.after);
  },

  beginGesture: (label) => {
    const { gesture, flat, readOnly } = get();
    if (gesture || readOnly) return;
    set({ gesture: { label, base: flat } });
  },

  endGesture: () => {
    const { gesture, flat } = get();
    if (!gesture) return;
    const d = diff(gesture.base, flat);
    set((s) => ({
      gesture: null,
      past: d ? [...s.past.slice(-MAX_HISTORY + 1), { label: gesture.label, ...d }] : s.past,
      future: d ? [] : s.future,
    }));
  },

  undo: () => {
    const { past, doc, readOnly } = get();
    if (!doc || !past.length || readOnly) return;
    const entry = past[past.length - 1];
    const next = produce(doc, (d) => {
      applyPatch(d, entry.before);
      d.updatedAt = Date.now();
    });
    set((s) => ({ doc: next, flat: flatten(next), past: s.past.slice(0, -1), future: [...s.future, entry] }));
    sanitizeSelection();
    emit(entry.before);
    get().notify(`Annulé : ${entry.label}`);
  },

  redo: () => {
    const { future, doc, readOnly } = get();
    if (!doc || !future.length || readOnly) return;
    const entry = future[future.length - 1];
    const next = produce(doc, (d) => {
      applyPatch(d, entry.after);
      d.updatedAt = Date.now();
    });
    set((s) => ({ doc: next, flat: flatten(next), future: s.future.slice(0, -1), past: [...s.past, entry] }));
    sanitizeSelection();
    emit(entry.after);
    get().notify(`Rétabli : ${entry.label}`);
  },

  applyRemote: (patch) => {
    const { doc } = get();
    if (!doc) return;
    const next = produce(doc, (d) => {
      applyPatch(d, patch);
    });
    if (next === doc) return;
    set({ doc: next, flat: flatten(next) });
    // keep gesture base consistent so remote edits don't land in our undo entry
    const g = get().gesture;
    if (g) set({ gesture: { label: g.label, base: mergeIntoFlat(g.base, patch) } });
    sanitizeSelection();
  },

  setTime: (t) => {
    const doc = get().doc;
    const max = doc ? Math.max(totalDuration(doc), 1) : 0;
    set({ time: Math.max(0, Math.min(max, t)) });
  },

  select: (ids) => set({ selected: ids, selectedProp: null }),
  set: (partial) => set(partial),
  notify: (text) => set({ toast: { text, id: Date.now() } }),
}));

function mergeIntoFlat(base: Flat, p: Patch): Flat {
  const out: Flat = { ...base };
  for (const k in p) {
    if (p[k] == null) delete out[k];
    else out[k] = p[k];
  }
  return out;
}

function sanitizeSelection() {
  const { doc, selected, selectedProp, focusDancer } = useEditor.getState();
  if (!doc) return;
  const valid = selected.filter((id) => doc.dancers[id]);
  const patch: Partial<EditorState> = {};
  if (valid.length !== selected.length) patch.selected = valid;
  if (selectedProp && !doc.props[selectedProp]) patch.selectedProp = null;
  if (focusDancer && !doc.dancers[focusDancer]) patch.focusDancer = null;
  if (Object.keys(patch).length) useEditor.setState(patch);
}

/** Formation under the playhead (the one being held or left). */
export function currentItem(doc: Choreo, time: number) {
  const items = timeline(doc);
  const i = itemIndexAt(items, time);
  return { items, index: i, item: items[i] };
}

export function useCurrentFormationId(): ID | null {
  return useEditor((s) => {
    if (!s.doc) return null;
    const items = timeline(s.doc);
    return items[itemIndexAt(items, s.time)]?.f.id ?? null;
  });
}
