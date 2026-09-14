import { create } from 'zustand';
import { db } from '../lib/db';
import { flatten, type Flat, type Patch } from '../lib/flatten';
import { uid } from '../lib/id';
import type { Choreo, CollabLink, ID } from '../lib/types';
import { onLocalChange, useEditor } from '../store/editor';

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

const CLIENT_ID = uid(8);

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

export const displayName = () => localStorage.getItem('fs-name') || 'Chorégraphe';
export const displayColor = () => localStorage.getItem('fs-color') || '#ff4d8d';

function wsUrl(link: CollabLink) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws?room=${encodeURIComponent(link.roomId)}&key=${encodeURIComponent(link.key)}`;
}

export async function createRoom(doc: Choreo): Promise<CollabLink> {
  const flat = flatten(doc);
  const t = tick();
  const entries: Record<string, { v: unknown; t: string }> = {};
  const clock: Record<string, string> = {};
  for (const k in flat) {
    entries[k] = { v: flat[k], t };
    clock[k] = t;
  }
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
  if (!res.ok) throw new Error('Serveur de collaboration injoignable');
  const { roomId, editKey, viewKey } = await res.json();
  await db.setCollabState<Persisted>(doc.id, { clock, pending: [] });
  return { roomId, key: editKey, role: 'edit', editKey, viewKey };
}

export async function fetchRoom(roomId: string, key: string) {
  const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}?key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(res.status === 403 ? 'Lien invalide' : 'Salle introuvable');
  return (await res.json()) as { role: 'edit' | 'view'; entries: Record<string, { v: unknown; t: string }> };
}

export async function seedFromRoom(choreoId: ID, entries: Record<string, { v: unknown; t: string }>) {
  const clock: Record<string, string> = {};
  for (const k in entries) {
    clock[k] = entries[k].t;
    observe(entries[k].t);
  }
  await db.setCollabState<Persisted>(choreoId, { clock, pending: [] });
}

export async function ensureAudioUploaded(link: CollabLink, hash: string) {
  try {
    const check = await fetch(`/api/audio/${hash}?check=1&room=${link.roomId}&key=${link.key}`);
    if (!check.ok || (await check.json()).exists) return;
    const blob = await db.getAudio(hash);
    if (!blob) return;
    await fetch(`/api/audio/${hash}?room=${link.roomId}&key=${link.key}`, {
      method: 'PUT',
      headers: { 'content-type': blob.type || 'application/octet-stream' },
      body: blob,
    });
  } catch {
    /* offline — retried on next connect */
  }
}

export async function downloadAudio(link: CollabLink, hash: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/audio/${hash}?room=${link.roomId}&key=${link.key}`);
    if (!res.ok) return null;
    const blob = await res.blob();
    await db.putAudio(hash, blob);
    return blob;
  } catch {
    return null;
  }
}

/** One live session for the choreography open in the editor. */
export class CollabSession {
  private ws: WebSocket | null = null;
  private state: Persisted = { clock: {}, pending: [] };
  private closed = false;
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: (() => void)[] = [];
  private batch: Record<string, Op> = {};
  private inflight = new Map<string, Op[]>();

  constructor(
    private choreoId: ID,
    private link: CollabLink,
    private onMusicHash: (hash: string) => void,
  ) {}

  async start() {
    this.state = (await db.getCollabState<Persisted>(this.choreoId)) ?? { clock: {}, pending: [] };
    for (const t of Object.values(this.state.clock)) observe(t);
    useCollab.setState({ status: 'connecting', pending: this.state.pending.length, peers: {} });
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
    this.connect();
  }

  stop() {
    this.closed = true;
    this.unsubs.forEach((u) => u());
    window.removeEventListener('online', this.reconnectNow);
    if (this.timer) clearTimeout(this.timer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushBatch();
    this.ws?.close();
    useCollab.setState({ status: 'off', peers: {}, pending: 0 });
  }

  private reconnectNow = () => {
    if (this.ws && this.ws.readyState <= 1) return;
    this.retry = 0;
    this.connect();
  };

  private connect() {
    if (this.closed) return;
    useCollab.setState({ status: this.retry ? 'offline' : 'connecting' });
    const ws = new WebSocket(wsUrl(this.link));
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      ws.send(JSON.stringify({ type: 'hello', clientId: CLIENT_ID, name: displayName(), color: displayColor() }));
    };
    ws.onmessage = (ev) => this.message(JSON.parse(ev.data));
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.inflight.clear();
      if (this.closed) return;
      useCollab.setState({ status: 'offline', peers: {} });
      const delay = Math.min(15000, 800 * 2 ** this.retry++);
      this.timer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => ws.close();
  }

  private message(msg: any) {
    const editor = useEditor.getState();
    switch (msg.type) {
      case 'init': {
        const patch: Patch = {};
        for (const k in msg.entries) {
          const e = msg.entries[k];
          observe(e.t);
          const mine = this.state.clock[k];
          if (!mine || e.t > mine) {
            this.state.clock[k] = e.t;
            patch[k] = e.v;
          }
        }
        this.state.pending = this.state.pending.filter((op) => !msg.entries[op.k] || op.t > msg.entries[op.k].t);
        if (Object.keys(patch).length) editor.applyRemote(patch);
        if (msg.role === 'view' && !editor.readOnly) useEditor.setState({ readOnly: true });
        useCollab.setState({ status: 'online', error: undefined });
        this.persist();
        this.sendPending();
        this.schedulePresence();
        this.checkMusic();
        break;
      }
      case 'ops': {
        const patch: Patch = {};
        for (const op of msg.ops as Op[]) {
          observe(op.t);
          const mine = this.state.clock[op.k];
          if (!mine || op.t > mine) {
            this.state.clock[op.k] = op.t;
            patch[op.k] = op.v;
          }
        }
        if (Object.keys(patch).length) {
          editor.applyRemote(patch);
          if ('music' in patch) this.checkMusic();
          this.persist();
        }
        break;
      }
      case 'ack': {
        const sent = this.inflight.get(msg.id);
        this.inflight.delete(msg.id);
        if (sent) {
          const set = new Set(sent);
          this.state.pending = this.state.pending.filter((op) => !set.has(op));
          useCollab.setState({ pending: this.state.pending.length });
          this.persist();
        }
        break;
      }
      case 'presence': {
        if (msg.clientId === CLIENT_ID) break;
        useCollab.setState((s) => ({ peers: { ...s.peers, [msg.clientId]: { clientId: msg.clientId, ...msg.data } } }));
        break;
      }
      case 'leave': {
        useCollab.setState((s) => {
          const peers = { ...s.peers };
          delete peers[msg.clientId];
          return { peers };
        });
        break;
      }
      case 'error':
        useCollab.setState({ status: 'error', error: msg.message });
        break;
    }
  }

  private checkMusic() {
    const hash = useEditor.getState().doc?.music.hash;
    if (!hash) return;
    this.onMusicHash(hash);
    if (this.link.role === 'edit') ensureAudioUploaded(this.link, hash);
  }

  private local(after: Patch) {
    if (this.link.role !== 'edit') return;
    for (const k in after) {
      const t = tick();
      this.state.clock[k] = t;
      this.batch[k] = { k, v: after[k] ?? null, t };
    }
    if ('music' in after) {
      const hash = (after.music as any)?.hash;
      if (hash) ensureAudioUploaded(this.link, hash);
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
    this.sendPending();
  }

  private sendPending() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || useCollab.getState().status !== 'online') return;
    const flying = new Set([...this.inflight.values()].flat());
    const ops = this.state.pending.filter((o) => !flying.has(o));
    for (let i = 0; i < ops.length; i += 400) {
      const chunk = ops.slice(i, i + 400);
      const id = uid(6);
      this.inflight.set(id, chunk);
      ws.send(JSON.stringify({ type: 'ops', id, ops: chunk }));
    }
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      db.setCollabState<Persisted>(this.choreoId, this.state);
    }, 300);
  }

  private schedulePresence() {
    if (this.presenceTimer) return;
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      const { selected, time } = useEditor.getState();
      if (this.ws?.readyState === WebSocket.OPEN)
        this.ws.send(
          JSON.stringify({
            type: 'presence',
            data: { name: displayName(), color: displayColor(), selected, time },
          }),
        );
    }, 150);
  }
}

export type { Flat };
