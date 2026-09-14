import { createStore, del, get, set, values } from 'idb-keyval';
import type { Choreo, Folder, ID, Team } from './types';

const choreos = createStore('fs-choreos', 'kv');
const teams = createStore('fs-teams', 'kv');
const folders = createStore('fs-folders', 'kv');
const audio = createStore('fs-audio', 'kv');
const collab = createStore('fs-collab', 'kv');
const prefs = createStore('fs-prefs', 'kv');

export const db = {
  listChoreos: () => values<Choreo>(choreos),
  getChoreo: (id: ID) => get<Choreo>(id, choreos),
  saveChoreo: (doc: Choreo) => set(doc.id, doc, choreos),
  deleteChoreo: (id: ID) => Promise.all([del(id, choreos), del(id, collab)]),

  listTeams: () => values<Team>(teams),
  saveTeam: (t: Team) => set(t.id, t, teams),
  deleteTeam: (id: ID) => del(id, teams),

  listFolders: () => values<Folder>(folders),
  saveFolder: (f: Folder) => set(f.id, f, folders),
  deleteFolder: (id: ID) => del(id, folders),

  getAudio: (hash: string) => get<Blob>(hash, audio),
  putAudio: (hash: string, blob: Blob) => set(hash, blob, audio),

  getCollabState: <T>(choreoId: ID) => get<T>(choreoId, collab),
  setCollabState: <T>(choreoId: ID, state: T) => set(choreoId, state, collab),

  getPref: <T>(key: string) => get<T>(key, prefs),
  setPref: <T>(key: string, value: T) => set(key, value, prefs),
};
