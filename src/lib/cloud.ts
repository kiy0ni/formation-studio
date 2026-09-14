import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { useEditor } from '../store/editor';
import { useLibrary } from '../store/library';
import config from './cloud.config.json';
import { db, onDbChange, syncStore, type DirtyEntry, type SyncKind } from './db';
import { diff, flatten } from './flatten';
import type { Choreo, Folder, Team } from './types';

/**
 * Accounts and sync (Supabase). Local-first: the app always reads and writes the device's library;
 * when signed in, changes go up and come down in the background. The latest edit of an item wins.
 */
export const CLOUD_ENABLED = Boolean(config.url && config.key);

export type CloudStatus = 'off' | 'idle' | 'syncing' | 'offline' | 'error';
interface CloudState {
  email: string | null;
  status: CloudStatus;
  lastSync: number | null;
  error: string | null;
}
export const useCloud = create<CloudState>(() => ({ email: null, status: 'off', lastSync: null, error: null }));

type ItemKind = Exclude<SyncKind, 'audio'>;
type Item = Choreo | Team | Folder;
interface Row {
  kind: ItemKind;
  id: string;
  data: Item | null;
  updated_at: number;
  deleted: boolean;
  server_ts: string;
}

const AUTH_KEY = 'fs-auth';
const PAGE = 200;

let clientPromise: Promise<SupabaseClient> | null = null;
let session: Session | null = null;
let started: Promise<SupabaseClient> | null = null;
let resolveReady: () => void = () => {};
const ready = new Promise<void>((r) => (resolveReady = r));

function client() {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY },
    }),
  );
  return clientPromise;
}

/** Called once at launch: only loads the Supabase library if this device is signed in. */
export function startCloud() {
  if (!CLOUD_ENABLED) return resolveReady();
  let signedIn = false;
  try {
    signedIn = !!localStorage.getItem(AUTH_KEY);
  } catch {
    /* storage blocked */
  }
  if (signedIn) void init();
  else resolveReady();
}

function init() {
  started ??= (async () => {
    const sb = await client();
    sb.auth.onAuthStateChange((_event, s) => {
      // never await Supabase calls inside this callback
      setTimeout(() => void onSession(s), 0);
    });
    const { data } = await sb.auth.getSession();
    await onSession(data.session);
    resolveReady();
    onDbChange(() => schedule(3000));
    window.addEventListener('online', () => schedule(0));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && schedule(500));
    setInterval(() => document.visibilityState === 'visible' && schedule(0), 60_000);
    return sb;
  })();
  return started;
}

async function onSession(s: Session | null) {
  const previous = session?.user.id;
  session = s;
  useCloud.setState({ email: s?.user.email ?? null, status: s ? useCloud.getState().status === 'off' ? 'idle' : useCloud.getState().status : 'off' });
  if (!s || s.user.id === previous) return;
  const last = await syncStore.getMeta<string>('uid');
  if (last !== s.user.id) {
    await syncStore.markAll();
    await syncStore.setMeta('uid', s.user.id);
    await syncStore.setMeta('cursor', null);
  }
  schedule(0);
}

const ERRORS: [RegExp, string][] = [
  [/invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
  [/already registered|already exists/i, 'Ce compte existe déjà : connectez-vous.'],
  [/password should be at least|weak password/i, 'Mot de passe : 6 caractères minimum.'],
  [/invalid.*email|email.*invalid/i, 'E-mail invalide.'],
  [/rate limit|too many|security purposes/i, 'Trop d’essais, réessayez dans une minute.'],
  [/should be different/i, 'Choisissez un mot de passe différent de l’ancien.'],
  [/token has expired|invalid.*token|otp/i, 'Code incorrect ou expiré.'],
  [/error sending|smtp/i, 'Envoi de l’e-mail impossible pour le moment.'],
  [/fetch|network|load failed/i, 'Pas de connexion internet.'],
];
const french = (msg: string) => ERRORS.find(([re]) => re.test(msg))?.[1] ?? msg;

export async function signIn(email: string, password: string, createAccount: boolean) {
  const sb = await init();
  const res = createAccount ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
  if (res.error) throw new Error(french(res.error.message));
  if (!res.data.session) throw new Error('Compte créé : connectez-vous.');
  await onSession(res.data.session);
}

/** Signed in: new password, no email needed. */
export async function changePassword(password: string) {
  const sb = await init();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw new Error(french(error.message));
}

/** Forgotten password, step 1: a code is emailed. */
export async function sendResetCode(email: string) {
  const sb = await init();
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error) throw new Error(french(error.message));
}

/** Forgotten password, step 2: code + new password, then signed in. */
export async function resetWithCode(email: string, code: string, password: string) {
  const sb = await init();
  const { data, error } = await sb.auth.verifyOtp({ email, token: code, type: 'recovery' });
  if (error || !data.session) throw new Error(french(error?.message ?? 'otp'));
  await onSession(data.session);
  const updated = await sb.auth.updateUser({ password });
  if (updated.error) throw new Error(french(updated.error.message));
}

/** Deletes the account and everything stored online. The password is checked again first. */
export async function deleteAccount(password: string) {
  const sb = await init();
  const user = session?.user;
  if (!user?.email) throw new Error('Non connecté.');
  const check = await sb.auth.signInWithPassword({ email: user.email, password });
  if (check.error) throw new Error(/invalid login/i.test(check.error.message) ? 'Mot de passe incorrect.' : french(check.error.message));
  // music files first: the database cannot remove them
  for (;;) {
    const { data, error } = await sb.storage.from('audio').list(user.id, { limit: 100 });
    if (error) throw new Error(error.message);
    if (!data.length) break;
    const removed = await sb.storage.from('audio').remove(data.map((f) => `${user.id}/${f.name}`));
    if (removed.error) throw new Error(removed.error.message);
    if (data.length < 100) break;
  }
  // music of the choreographies this person shared (the rooms themselves go with the account)
  const owned = await sb.from('room_members').select('room_id').eq('user_id', user.id).eq('role', 'owner');
  for (const { room_id } of (owned.data ?? []) as { room_id: string }[]) {
    const files = await sb.storage.from('room-audio').list(room_id, { limit: 100 });
    if (files.data?.length) await sb.storage.from('room-audio').remove(files.data.map((f) => `${room_id}/${f.name}`));
  }
  const { error } = await sb.rpc('delete_my_account');
  if (error) throw new Error(error.message);
  await sb.auth.signOut({ scope: 'local' });
  session = null;
  await syncStore.setMeta('uid', null);
  await syncStore.setMeta('cursor', null);
  useCloud.setState({ email: null, status: 'off', error: null });
}

export async function signOut() {
  const sb = await init();
  await sb.auth.signOut({ scope: 'local' });
  session = null;
  useCloud.setState({ email: null, status: 'off', error: null });
}

/* ---------------------------------- sync --------------------------------- */

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let again = false;

function schedule(ms: number) {
  if (!session) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncNow();
  }, ms);
}

export async function syncNow() {
  if (!session) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    await syncOnce();
  } finally {
    running = false;
    if (again) {
      again = false;
      schedule(1000);
    }
  }
}

async function syncOnce() {
  if (!navigator.onLine) return void useCloud.setState({ status: 'offline' });
  const sb = await client();
  useCloud.setState({ status: 'syncing', error: null });
  try {
    const { changed, docs } = await pull(sb);
    await push(sb);
    useCloud.setState({ status: 'idle', lastSync: Date.now() });
    if (changed) await useLibrary.getState().refresh();
    if (docs.length) void prefetchAudio(sb, docs);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    const offline = /fetch|network|load failed/i.test(msg) || !navigator.onLine;
    useCloud.setState({ status: offline ? 'offline' : 'error', error: offline ? null : msg });
  }
}

const readLocal = (kind: ItemKind, id: string): Promise<Item | undefined> =>
  kind === 'choreo' ? db.getChoreo(id) : kind === 'team' ? db.getTeam(id) : db.getFolder(id);
const stamp = (item: Item) => item.updatedAt ?? 0;

async function pull(sb: SupabaseClient) {
  const docs: Choreo[] = [];
  let changed = false;
  const cursor = await syncStore.getMeta<string>('cursor');
  // small overlap: a row committed a moment late is never missed (applying twice is harmless)
  let after = cursor ? new Date(new Date(cursor).getTime() - 5000).toISOString() : '1970-01-01T00:00:00Z';
  for (;;) {
    const { data, error } = await sb.from('items').select('kind,id,data,updated_at,deleted,server_ts').gt('server_ts', after).order('server_ts').limit(PAGE);
    if (error) throw new Error(error.message);
    const rows = data as Row[];
    for (const row of rows) {
      if (!(await applyRow(row))) continue;
      changed = true;
      if (row.kind === 'choreo' && row.data && !row.deleted) docs.push(row.data as Choreo);
    }
    if (rows.length) {
      after = rows[rows.length - 1].server_ts;
      await syncStore.setMeta('cursor', after);
    }
    if (rows.length < PAGE) break;
  }
  return { changed, docs };
}

async function applyRow(row: Row): Promise<boolean> {
  const local = await readLocal(row.kind, row.id);
  const dirty = await syncStore.getDirty(row.kind, row.id);
  const settle = async () => {
    if (dirty && dirty.at <= row.updated_at) await syncStore.clearDirty(row.kind, row.id, dirty.at);
  };

  if (row.deleted) {
    if (dirty && dirty.at > row.updated_at) return false; // edited here after the deletion: keep it
    await settle();
    if (!local || stamp(local) > row.updated_at) return false;
    if (row.kind === 'choreo') {
      await db.deleteChoreo(row.id, { remote: true });
      if (useEditor.getState().doc?.id === row.id) location.hash = '#/';
    } else if (row.kind === 'team') await db.deleteTeam(row.id, { remote: true });
    else await db.deleteFolder(row.id, { remote: true });
    return true;
  }

  if (!row.data) return false;
  if (dirty?.deleted && dirty.at >= row.updated_at) return false; // deleted here more recently
  if (local && stamp(local) >= row.updated_at) {
    await settle();
    return false;
  }
  if (row.kind === 'choreo') {
    await db.saveChoreo(row.data as Choreo, { remote: true });
    applyToOpenEditor(row.data as Choreo);
  } else if (row.kind === 'team') await db.saveTeam(row.data as Team, { remote: true });
  else await db.saveFolder(row.data as Folder, { remote: true });
  await settle();
  return true;
}

/** The choreography open on screen was edited on another device: show the new version in place. */
function applyToOpenEditor(remote: Choreo) {
  const s = useEditor.getState();
  if (!s.doc || s.doc.id !== remote.id || s.doc.updatedAt >= remote.updatedAt || s.gesture) return;
  const change = diff(s.flat, flatten(remote));
  if (change) s.applyRemote(change.after);
  const doc = useEditor.getState().doc;
  if (doc) useEditor.setState({ doc: { ...doc, updatedAt: remote.updatedAt } });
}

async function push(sb: SupabaseClient) {
  const entries = await syncStore.listDirty();
  // music first, so a choreography usually arrives with its song; a song that fails never blocks the rest
  for (const e of entries.filter((x) => x.kind === 'audio')) {
    try {
      await uploadAudio(sb, e.id);
      await syncStore.clearDirty('audio', e.id, e.at);
    } catch (err) {
      console.warn('[sync] music not sent, retried next time:', e.id, err);
    }
  }
  const rows: Omit<Row, 'server_ts'>[] = [];
  const sent: DirtyEntry[] = [];
  for (const e of entries) {
    if (e.kind === 'audio') continue;
    const kind = e.kind;
    if (e.deleted) rows.push({ kind, id: e.id, data: null, updated_at: e.at, deleted: true });
    else {
      const item = await readLocal(kind, e.id);
      if (item) rows.push({ kind, id: e.id, data: item, updated_at: stamp(item), deleted: false });
    }
    sent.push(e);
  }
  for (let i = 0; i < rows.length; i += 25) {
    const { error } = await sb.rpc('push_items', { rows: rows.slice(i, i + 25) });
    if (error) throw new Error(error.message);
  }
  for (const e of sent) await syncStore.clearDirty(e.kind, e.id, e.at);
}

const audioPath = (hash: string) => `${session!.user.id}/${hash}`;

async function uploadAudio(sb: SupabaseClient, hash: string) {
  const blob = await db.getAudio(hash);
  if (!(blob instanceof Blob) || !blob.size) return; // nothing usable stored for this song
  // bytes in memory: blobs read back from IndexedDB can reach the network empty in some web views
  const bytes = await blob.arrayBuffer().catch(() => null);
  if (!bytes?.byteLength) return;
  const { error } = await sb.storage.from('audio').upload(audioPath(hash), bytes, { upsert: false, contentType: blob.type || 'application/octet-stream' });
  if (error && !/exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) throw new Error(error.message);
}

async function downloadAudio(sb: SupabaseClient, hash: string) {
  const { data, error } = await sb.storage.from('audio').download(audioPath(hash));
  if (error || !data) return null;
  await db.putAudio(hash, data, { remote: true });
  return data;
}

/** Songs of choreographies received from the account, so rehearsing offline works. */
async function prefetchAudio(sb: SupabaseClient, docs: Choreo[]) {
  for (const hash of new Set(docs.map((d) => d.music.hash).filter(Boolean) as string[])) {
    if (!session || (await db.getAudio(hash))) continue;
    await downloadAudio(sb, hash).catch(() => null);
  }
}

/** Signed-in client for features that need an account (shared choreographies). */
export async function cloudSession(): Promise<{ sb: SupabaseClient; userId: string; email: string } | null> {
  if (!CLOUD_ENABLED) return null;
  await ready;
  if (!session) return null;
  return { sb: await client(), userId: session.user.id, email: session.user.email ?? '' };
}

/** Music missing on this device (editor): fetch it from the account. */
export async function fetchCloudAudio(hash: string): Promise<Blob | null> {
  if (!CLOUD_ENABLED) return null;
  await ready;
  if (!session) return null;
  try {
    return await downloadAudio(await client(), hash);
  } catch {
    return null;
  }
}
