import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { create } from 'zustand';
import { cloudSession, fetchCloudAudio, useCloud } from '../lib/cloud';
import { db } from '../lib/db';
import { flatten, type Flat, type Patch } from '../lib/flatten';
import { uid } from '../lib/id';
import type { Choreo, CollabLink, ID } from '../lib/types';
import { onLocalChange, useEditor } from '../store/editor';

/**
 * Shared choreographies over Supabase (account required):
 * - the room keeps the choreography as a flat map { key: { v, t } } (latest timestamp wins),
 * - edits are saved with `room_push`, then broadcast live on the private channel "room:<id>",
 * - presence shows who is there and what they select.
 * Offline edits stay pending on the device and are sent when the connection comes back.
 */

export interface Peer {
  clientId: string;
  name: string;
  color: string;
  selected: ID[];
  time: number;
}

export type CollabStatus = 'off' | 'connecting' | 'online' | 'offline' | 'error';

interface CollabUi {
  status: CollabStatus;
  pending: number;
  peers: Record<string, Peer>;
  error?: string;
}

export const useCollab = create<CollabUi>(() => ({ status: 'off', pending: 0, peers: {} }));

interface Op {
  k: string;
  v: unknown;
  t: string;
}

interface Persisted {
  clock: Record<string, string>;
  pending: Op[];
}

type Entries = Record<string, { v: unknown; t: string }>;
export interface RoomSnapshot {
  role: 'edit' | 'view';
  owner: boolean;
  entries: Entries;
  editCode: string | null;
  viewCode: string | null;
}
export interface RoomMember {
  userId: string;
  name: string;
  role: 'owner' | 'edit' | 'view';
  me: boolean;
}

const CLIENT_ID = uid(8);
const AUDIO_BUCKET = 'room-audio';
const CHUNK = 150;

/** Hybrid logical clock → lexicographically comparable timestamps. */
let lastMs = 0;
let counter = 0;
function tick(): string {
  const now = Date.now();
  if (now > lastMs) {
    lastMs = now;
    counter = 0;
  } else counter++;
  return `${lastMs.toString(36).padStart(9, '0')}-${counter.toString(36).padStart(4, '0')}-${CLIENT_ID}`;
}
function observe(t: string) {
  const ms = parseInt(t.slice(0, 9), 36);
  const c = parseInt(t.slice(10, 14), 36);
  if (ms > lastMs) {
    lastMs = ms;
    counter = c;
  } else if (ms === lastMs && c > counter) counter = c;
}

export const displayName = () => localStorage.getItem('fs-name') || useCloud.getState().email?.split('@')[0] || 'Chorégraphe';
export const displayColor = () => localStorage.getItem('fs-color') || '#ff4d8d';

async function signedIn() {
  const c = await cloudSession();
  if (!c) throw new Error('Connectez-vous pour partager.');
  return c;
}

const ERRORS: [RegExp, string][] = [
  [/invalid link|invalid input syntax for type uuid/i, 'Lien invalide ou expiré'],
  [/no access/i, 'Accès retiré'],
  [/read only/i, 'Lecture seule'],
  [/owner only/i, 'Réservé au créateur du partage'],
  [/fetch|network|load failed/i, 'Pas de connexion internet'],
];
const french = (msg: string) => ERRORS.find(([re]) => re.test(msg))?.[1] ?? msg;

export async function createRoom(doc: Choreo): Promise<CollabLink> {
  const { sb } = await signedIn();
  const flat = flatten(doc);
  const t = tick();
  const entries: Entries = {};
  const clock: Record<string, string> = {};
  for (const k in flat) {
    entries[k] = { v: flat[k] ?? null, t };
    clock[k] = t;
  }
  const { data, error } = await sb.rpc('create_room', { p_entries: entries, p_name: displayName() });
  if (error) throw new Error(french(error.message));
  const r = data as { room: string; edit_code: string; view_code: string };
  await db.setCollabState<Persisted>(doc.id, { clock, pending: [] });
  return { roomId: r.room, key: r.edit_code, role: 'edit', owner: true, editKey: r.edit_code, viewKey: r.view_code };
}

/** Current state of a room the user belongs to (also tells the role and, for editors, the links). */
export async function openRoom(roomId: string): Promise<RoomSnapshot> {
  const { sb } = await signedIn();
  const { data, error } = await sb.rpc('room_open', { p_room: roomId });
  if (error) throw new Error(french(error.message));
  const r = data as { role: 'owner' | 'edit' | 'view'; entries: Entries; edit_code: string | null; view_code: string | null };
  return { role: r.role === 'view' ? 'view' : 'edit', owner: r.role === 'owner', entries: r.entries ?? {}, editCode: r.edit_code, viewCode: r.view_code };
}

/** Opening a shared link: becomes a member (editor or reader), then reads the room. */
export async function fetchRoom(roomId: string, code: string): Promise<RoomSnapshot> {
  const { sb } = await signedIn();
  const { error } = await sb.rpc('join_room', { p_room: roomId, p_code: code, p_name: displayName() });
  if (error) throw new Error(french(error.message));
  return openRoom(roomId);
}

export async function seedFromRoom(choreoId: ID, entries: Entries) {
  const clock: Record<string, string> = {};
  for (const k in entries) {
    clock[k] = entries[k].t;
    observe(entries[k].t);
  }
  await db.setCollabState<Persisted>(choreoId, { clock, pending: [] });
}

export async function listMembers(roomId: string): Promise<RoomMember[]> {
  const { sb, userId } = await signedIn();
  const { data, error } = await sb.from('room_members').select('user_id,name,role').eq('room_id', roomId).order('joined_at');
  if (error) throw new Error(french(error.message));
  return (data as { user_id: string; name: string; role: RoomMember['role'] }[]).map((m) => ({ userId: m.user_id, name: m.name || 'Membre', role: m.role, me: m.user_id === userId }));
}

export async function removeMember(roomId: string, userId: string) {
  const { sb } = await signedIn();
  const { error } = await sb.from('room_members').delete().eq('room_id', roomId).eq('user_id', userId);
  if (error) throw new Error(french(error.message));
}

/** Owner: new links; the old ones stop working (people already in keep their access). */
export async function rotateCodes(roomId: string): Promise<{ editKey: string; viewKey: string }> {
  const { sb } = await signedIn();
  const { data, error } = await sb.rpc('rotate_room_codes', { p_room: roomId });
  if (error) throw new Error(french(error.message));
  const r = data as { edit_code: string; view_code: string };
  return { editKey: r.edit_code, viewKey: r.view_code };
}

export async function ensureAudioUploaded(link: CollabLink, hash: string) {
  if (link.role !== 'edit') return;
  try {
    const c = await cloudSession();
    const blob = await db.getAudio(hash);
    if (!c || !(blob instanceof Blob) || !blob.size) return;
    const bytes = await blob.arrayBuffer();
    const { error } = await c.sb.storage.from(AUDIO_BUCKET).upload(`${link.roomId}/${hash}`, bytes, { upsert: false, contentType: blob.type || 'application/octet-stream' });
    if (error && !/exists|duplicate|409/i.test(`${error.message} ${(error as { statusCode?: string }).statusCode ?? ''}`)) console.warn('[share] music not uploaded', error.message);
  } catch {
    /* offline: retried when the room reconnects */
  }
}

export async function downloadAudio(link: CollabLink, hash: string): Promise<Blob | null> {
  try {
    const c = await cloudSession();
    if (c) {
      const { data } = await c.sb.storage.from(AUDIO_BUCKET).download(`${link.roomId}/${hash}`);
      if (data?.size) {
        await db.putAudio(hash, data, { remote: true });
        return data;
      }
    }
  } catch {
    /* fall back to the account's own copy */
  }
  return fetchCloudAudio(hash);
}

/** One live session for the choreography open in the editor. */
export class CollabSession {
  private sb: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private state: Persisted = { clock: {}, pending: [] };
  private closed = false;
  private online = false;
  private sending = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];
  private batch: Record<string, Op> = {};

  constructor(
    private choreoId: ID,
    private link: CollabLink,
    private onMusicHash: (hash: string) => void,
  ) {}

  async start() {
    this.state = (await db.getCollabState<Persisted>(this.choreoId)) ?? { clock: {}, pending: [] };
    for (const t of Object.values(this.state.clock)) observe(t);
    useCollab.setState({ status: 'connecting', pending: this.state.pending.length, peers: {}, error: undefined });
    this.unsubs.push(onLocalChange((after) => this.local(after)));
    let lastSel = '';
    this.unsubs.push(
      useEditor.subscribe((s) => {
        const key = s.selected.join(',') + '|' + Math.round(s.time * 4);
        if (key !== lastSel) {
          lastSel = key;
          this.schedulePresence();
        }
      }),
    );
    window.addEventListener('online', this.reconnectNow);
    void this.connect();
  }

  stop() {
    this.closed = true;
    this.online = false;
    this.unsubs.forEach((u) => u());
    window.removeEventListener('online', this.reconnectNow);
    for (const t of [this.timer, this.flushTimer, this.presenceTimer]) if (t) clearTimeout(t);
    this.flushBatch();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      void db.setCollabState<Persisted>(this.choreoId, this.state);
    }
    const channel = this.channel;
    this.channel = null;
    if (channel && this.sb) void this.sb.removeChannel(channel);
    useCollab.setState({ status: 'off', peers: {}, pending: 0 });
  }

  private reconnectNow = () => {
    if (this.online || this.closed) return;
    this.retry = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.connect();
  };

  private scheduleReconnect() {
    this.online = false;
    if (this.closed || this.timer) return;
    useCollab.setState({ status: 'offline', peers: {} });
    const delay = Math.min(15000, 800 * 2 ** this.retry++);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private async connect() {
    if (this.closed) return;
    const c = await cloudSession();
    if (!c) return void useCollab.setState({ status: 'error', error: 'Connectez-vous pour retrouver le partage.' });
    this.sb = c.sb;
    const old = this.channel;
    this.channel = null;
    if (old) await c.sb.removeChannel(old);
    useCollab.setState({ status: this.retry ? 'offline' : 'connecting' });

    try {
      this.init(await openRoom(this.link.roomId));
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === 'Accès retiré') return void useCollab.setState({ status: 'error', error: 'Votre accès à cette chorégraphie a été retiré.' });
      if (/invalide|expiré/i.test(msg)) return void useCollab.setState({ status: 'error', error: msg });
      return this.scheduleReconnect();
    }
    if (this.closed) return;

    const channel = c.sb.channel(`room:${this.link.roomId}`, { config: { private: true, broadcast: { self: false }, presence: { key: CLIENT_ID } } });
    this.channel = channel;
    channel
      .on('broadcast', { event: 'ops' }, ({ payload }) => this.remoteOps(((payload as { ops?: Op[] }).ops ?? []) as Op[]))
      .on('presence', { event: 'sync' }, () => this.syncPeers())
      .subscribe((status) => {
        if (this.channel !== channel || this.closed) return;
        if (status === 'SUBSCRIBED') {
          this.retry = 0;
          this.online = true;
          useCollab.setState({ status: 'online', error: undefined });
          this.schedulePresence();
          void this.sendPending();
          // edits made between the snapshot and the subscription
          openRoom(this.link.roomId)
            .then((room) => this.channel === channel && this.init(room))
            .catch(() => {});
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          this.channel = null;
          void c.sb.removeChannel(channel);
          this.scheduleReconnect();
        }
      });
  }

  private apply(entries: Iterable<Op>) {
    const patch: Patch = {};
    for (const op of entries) {
      observe(op.t);
      const mine = this.state.clock[op.k];
      if (!mine || op.t > mine) {
        this.state.clock[op.k] = op.t;
        patch[op.k] = op.v;
      }
    }
    if (Object.keys(patch).length) {
      useEditor.getState().applyRemote(patch);
      if ('music' in patch) this.checkMusic();
      this.persist();
    }
  }

  private init(room: RoomSnapshot) {
    this.apply(Object.entries(room.entries).map(([k, e]) => ({ k, v: e.v, t: e.t })));
    this.state.pending = this.state.pending.filter((op) => !room.entries[op.k] || op.t > room.entries[op.k].t);
    if (room.role !== this.link.role) this.link = { ...this.link, role: room.role };
    const readOnly = room.role === 'view';
    if (useEditor.getState().readOnly !== readOnly) useEditor.setState({ readOnly });
    useCollab.setState({ pending: this.state.pending.length });
    this.persist();
    this.checkMusic();
  }

  private remoteOps(ops: Op[]) {
    this.apply(ops.filter((op) => op && typeof op.k === 'string' && typeof op.t === 'string'));
  }

  private syncPeers() {
    const presence = this.channel?.presenceState<{ name?: string; color?: string; selected?: ID[]; time?: number }>() ?? {};
    const peers: Record<string, Peer> = {};
    for (const [key, metas] of Object.entries(presence)) {
      const m = metas[metas.length - 1];
      if (key === CLIENT_ID || !m) continue;
      peers[key] = { clientId: key, name: String(m.name ?? 'Membre'), color: String(m.color ?? '#ff4d8d'), selected: Array.isArray(m.selected) ? m.selected : [], time: Number(m.time) || 0 };
    }
    useCollab.setState({ peers });
  }

  private checkMusic() {
    const hash = useEditor.getState().doc?.music.hash;
    if (!hash) return;
    this.onMusicHash(hash);
    if (this.link.role === 'edit') void ensureAudioUploaded(this.link, hash);
  }

  private local(after: Patch) {
    if (this.link.role !== 'edit') return;
    for (const k in after) {
      const t = tick();
      this.state.clock[k] = t;
      this.batch[k] = { k, v: after[k] ?? null, t };
    }
    if ('music' in after) {
      const hash = (after.music as { hash?: string } | null)?.hash;
      if (hash) void ensureAudioUploaded(this.link, hash);
    }
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flushBatch(), 60);
  }

  private flushBatch() {
    this.flushTimer = null;
    const ops = Object.values(this.batch);
    if (!ops.length) return;
    this.batch = {};
    const replaced = new Set(ops.map((o) => o.k));
    this.state.pending = [...this.state.pending.filter((o) => !replaced.has(o.k)), ...ops];
    useCollab.setState({ pending: this.state.pending.length });
    this.persist();
    void this.sendPending();
  }

  /** Saves pending edits in the room, then shows them live to the others. */
  private async sendPending() {
    if (this.sending || !this.online || !this.sb) return;
    this.sending = true;
    let retryLater = false;
    try {
      while (this.state.pending.length && this.online && !this.closed) {
        const chunk = this.state.pending.slice(0, CHUNK);
        const { error } = await this.sb.rpc('room_push', { p_room: this.link.roomId, p_ops: chunk });
        if (error) {
          if (/read only|no access/i.test(error.message)) {
            this.state.pending = [];
            this.link = { ...this.link, role: 'view' };
            useEditor.setState({ readOnly: true });
            useCollab.setState({ pending: 0, status: 'error', error: 'Lecture seule : vos modifications ne sont pas partagées.' });
            this.persist();
          } else retryLater = true;
          break;
        }
        const sent = new Set(chunk);
        this.state.pending = this.state.pending.filter((o) => !sent.has(o));
        useCollab.setState({ pending: this.state.pending.length });
        this.persist();
        void this.channel?.send({ type: 'broadcast', event: 'ops', payload: { ops: chunk } });
      }
    } finally {
      this.sending = false;
    }
    if (retryLater && !this.closed) setTimeout(() => void this.sendPending(), 3000);
  }

  private persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void db.setCollabState<Persisted>(this.choreoId, this.state);
    }, 300);
  }

  private schedulePresence() {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      if (!this.online || !this.channel) return;
      const { selected, time } = useEditor.getState();
      void this.channel.track({ name: displayName(), color: displayColor(), selected, time });
    }, 300);
  }
}

export type { Flat };
