import { createStore, del, entries, get, keys, set, values } from 'idb-keyval';
import type { Choreo, Folder, ID, Team } from './types';

const choreos = createStore('fs-choreos', 'kv');
const teams = createStore('fs-teams', 'kv');
const folders = createStore('fs-folders', 'kv');
const audio = createStore('fs-audio', 'kv');
const collab = createStore('fs-collab', 'kv');
const prefs = createStore('fs-prefs', 'kv');
/** Reference videos: device only, never synced. */
const videos = createStore('fs-video', 'kv');
/** Local edits not yet sent to the account ("d:kind:id") and sync bookkeeping ("m:key"). */
const sync = createStore('fs-sync', 'kv');

export type SyncKind = 'choreo' | 'team' | 'folder' | 'audio';
export interface DirtyEntry {
  kind: SyncKind;
  id: string;
  at: number;
  deleted?: boolean;
}
/** `remote: true` = the change came from the account: don't send it back. */
type WriteOpts = { remote?: boolean };

const listeners = new Set<() => void>();
export const onDbChange = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

async function mark(kind: SyncKind, id: string, at: number, deleted?: boolean) {
  await set(`d:${kind}:${id}`, { kind, id, at, deleted } satisfies DirtyEntry, sync);
  listeners.forEach((fn) => fn());
}

export const db = {
  listChoreos: () => values<Choreo>(choreos),
  getChoreo: (id: ID) => get<Choreo>(id, choreos),
  saveChoreo: async (doc: Choreo, o?: WriteOpts) => {
    await set(doc.id, doc, choreos);
    if (!o?.remote) await mark('choreo', doc.id, doc.updatedAt);
  },
  deleteChoreo: async (id: ID, o?: WriteOpts) => {
    await Promise.all([del(id, choreos), del(id, collab)]);
    if (!o?.remote) await mark('choreo', id, Date.now(), true);
  },

  listTeams: () => values<Team>(teams),
  getTeam: (id: ID) => get<Team>(id, teams),
  saveTeam: async (t: Team, o?: WriteOpts) => {
    await set(t.id, t, teams);
    if (!o?.remote) await mark('team', t.id, t.updatedAt);
  },
  deleteTeam: async (id: ID, o?: WriteOpts) => {
    await del(id, teams);
    if (!o?.remote) await mark('team', id, Date.now(), true);
  },

  listFolders: () => values<Folder>(folders),
  getFolder: (id: ID) => get<Folder>(id, folders),
  saveFolder: async (f: Folder, o?: WriteOpts) => {
    const v = o?.remote ? f : { ...f, updatedAt: Date.now() };
    await set(v.id, v, folders);
    if (!o?.remote) await mark('folder', v.id, v.updatedAt ?? 0);
  },
  deleteFolder: async (id: ID, o?: WriteOpts) => {
    await del(id, folders);
    if (!o?.remote) await mark('folder', id, Date.now(), true);
  },

  getAudio: (hash: string) => get<Blob>(hash, audio),
  putAudio: async (hash: string, blob: Blob, o?: WriteOpts) => {
    await set(hash, blob, audio);
    if (!o?.remote) await mark('audio', hash, Date.now());
  },

  getVideo: (hash: string) => get<Blob>(hash, videos),
  putVideo: (hash: string, blob: Blob) => set(hash, blob, videos),
  deleteVideo: (hash: string) => del(hash, videos),

  getCollabState: <T>(choreoId: ID) => get<T>(choreoId, collab),
  setCollabState: <T>(choreoId: ID, state: T) => set(choreoId, state, collab),

  getPref: <T>(key: string) => get<T>(key, prefs),
  setPref: <T>(key: string, value: T) => set(key, value, prefs),
};

export const syncStore = {
  listDirty: async () => (await entries<string, DirtyEntry>(sync)).filter(([k]) => k.startsWith('d:')).map(([, v]) => v),
  getDirty: (kind: SyncKind, id: string) => get<DirtyEntry>(`d:${kind}:${id}`, sync),
  /** Only clears if nothing changed since `at` (an edit made during the upload stays pending). */
  clearDirty: async (kind: SyncKind, id: string, at: number) => {
    const key = `d:${kind}:${id}`;
    const cur = await get<DirtyEntry>(key, sync);
    if (cur && cur.at === at) await del(key, sync);
  },
  /** First sign-in on this device: everything local goes to the account. */
  markAll: async () => {
    const [c, t, f, a] = await Promise.all([values<Choreo>(choreos), values<Team>(teams), values<Folder>(folders), keys<string>(audio)]);
    for (const x of c) await set(`d:choreo:${x.id}`, { kind: 'choreo', id: x.id, at: x.updatedAt }, sync);
    for (const x of t) await set(`d:team:${x.id}`, { kind: 'team', id: x.id, at: x.updatedAt }, sync);
    for (const x of f) await set(`d:folder:${x.id}`, { kind: 'folder', id: x.id, at: x.updatedAt ?? 0 }, sync);
    for (const h of a) await set(`d:audio:${h}`, { kind: 'audio', id: h, at: 0 }, sync);
  },
  getMeta: <T>(key: string) => get<T>(`m:${key}`, sync),
  setMeta: <T>(key: string, value: T) => set(`m:${key}`, value, sync),
};
