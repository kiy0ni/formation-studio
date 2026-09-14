// Formation Studio — static server + real-time collaboration (WebSocket, LWW per key).
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, createReadStream } from 'node:fs';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const DATA = process.env.DATA_DIR || join(ROOT, 'server', 'data');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_AUDIO = 60 * 1024 * 1024;

mkdirSync(join(DATA, 'rooms'), { recursive: true });
mkdirSync(join(DATA, 'audio'), { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const ROOM_RE = /^[a-z0-9]{10,32}$/;
const HASH_RE = /^[a-f0-9]{16,64}$/;
const token = (n = 18) => randomBytes(n).toString('base64url').replace(/[^a-zA-Z0-9]/g, '').slice(0, n);

/** @type {Map<string, {id:string, editKey:string, viewKey:string, entries:Record<string,{v:any,t:string}>, clients:Set<any>, dirty:boolean}>} */
const rooms = new Map();

async function loadRoom(id) {
  if (!ROOM_RE.test(id)) return null;
  if (rooms.has(id)) return rooms.get(id);
  try {
    const raw = JSON.parse(await readFile(join(DATA, 'rooms', `${id}.json`), 'utf8'));
    const room = { ...raw, clients: new Set(), dirty: false };
    rooms.set(id, room);
    return room;
  } catch {
    return null;
  }
}

async function saveRoom(room) {
  if (!room.dirty) return;
  room.dirty = false;
  const file = join(DATA, 'rooms', `${room.id}.json`);
  const tmp = `${file}.tmp`;
  const { id, editKey, viewKey, entries } = room;
  await writeFile(tmp, JSON.stringify({ id, editKey, viewKey, entries }));
  await rename(tmp, file);
}

setInterval(() => {
  for (const room of rooms.values()) {
    saveRoom(room).catch((e) => console.error('save failed', e));
    if (!room.clients.size && !room.dirty) rooms.delete(room.id);
  }
}, 2000);

const roleFor = (room, key) => (key && key === room.editKey ? 'edit' : key && key === room.viewKey ? 'view' : null);

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validEntries(entries) {
  if (!entries || typeof entries !== 'object') return false;
  for (const k in entries) {
    const e = entries[k];
    if (typeof k !== 'string' || k.length > 120 || !e || typeof e.t !== 'string' || e.t.length > 40) return false;
  }
  return true;
}

async function api(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/rooms') {
    const body = JSON.parse((await readBody(req, 20 * 1024 * 1024)).toString('utf8') || '{}');
    if (!validEntries(body.entries)) return json(res, 400, { error: 'bad entries' });
    const room = { id: token(16).toLowerCase().replace(/[^a-z0-9]/g, '0'), editKey: token(22), viewKey: token(22), entries: body.entries, clients: new Set(), dirty: true };
    rooms.set(room.id, room);
    await saveRoom(room);
    return json(res, 201, { roomId: room.id, editKey: room.editKey, viewKey: room.viewKey });
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)$/);
  if (req.method === 'GET' && roomMatch) {
    const room = await loadRoom(roomMatch[1]);
    if (!room) return json(res, 404, { error: 'not found' });
    const role = roleFor(room, url.searchParams.get('key'));
    if (!role) return json(res, 403, { error: 'forbidden' });
    return json(res, 200, { role, entries: room.entries });
  }

  const audioMatch = url.pathname.match(/^\/api\/audio\/([^/]+)$/);
  if (audioMatch) {
    const hash = audioMatch[1];
    if (!HASH_RE.test(hash)) return json(res, 400, { error: 'bad hash' });
    const room = await loadRoom(url.searchParams.get('room') || '');
    const role = room && roleFor(room, url.searchParams.get('key'));
    if (!role) return json(res, 403, { error: 'forbidden' });
    const file = join(DATA, 'audio', hash);
    if (req.method === 'PUT') {
      if (role !== 'edit') return json(res, 403, { error: 'read only' });
      const buf = await readBody(req, MAX_AUDIO);
      await writeFile(file, buf);
      await writeFile(`${file}.type`, String(req.headers['content-type'] || 'application/octet-stream').slice(0, 100));
      return json(res, 201, { ok: true });
    }
    if (req.method === 'GET' && url.searchParams.has('check')) return json(res, 200, { exists: existsSync(file) });
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!existsSync(file)) return json(res, 404, { error: 'not found' });
      const type = existsSync(`${file}.type`) ? readFileSync(`${file}.type`, 'utf8') : 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'content-length': statSync(file).size, 'cache-control': 'private, max-age=31536000, immutable' });
      if (req.method === 'HEAD') return res.end();
      return createReadStream(file).pipe(res);
    }
  }

  if (url.pathname === '/api/health') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'not found' });
}

async function serveStatic(req, res, url) {
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Formation Studio API. Lancez "npm run build" pour servir l\'application, ou "npm run dev" pour le mode développement.');
  }
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  let file = join(DIST, path);
  if (!file.startsWith(DIST)) return json(res, 400, { error: 'bad path' });
  let s = await stat(file).catch(() => null);
  if (!s || s.isDirectory()) {
    file = join(DIST, 'index.html');
    s = await stat(file);
  }
  const ext = extname(file);
  const immutable = file.includes(`${join(DIST, 'assets')}`);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': s.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status === 413 ? 'Fichier trop volumineux' : 'server error' });
    else res.end();
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/ws') return socket.destroy();
  const room = await loadRoom(url.searchParams.get('room') || '');
  const role = room && roleFor(room, url.searchParams.get('key'));
  if (!role) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, room, role));
});

function broadcast(room, except, msg) {
  const data = JSON.stringify(msg);
  for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(data);
}

function onConnection(ws, room, role) {
  ws.meta = { clientId: null, presence: null };
  room.clients.add(ws);
  ws.send(JSON.stringify({ type: 'init', role, entries: room.entries }));
  for (const c of room.clients) {
    if (c !== ws && c.meta.clientId && c.meta.presence)
      ws.send(JSON.stringify({ type: 'presence', clientId: c.meta.clientId, data: c.meta.presence }));
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      ws.meta.clientId = String(msg.clientId || '').slice(0, 16);
      ws.meta.presence = { name: String(msg.name || '').slice(0, 40), color: String(msg.color || '#ff4d8d').slice(0, 9), selected: [], time: 0 };
      broadcast(room, ws, { type: 'presence', clientId: ws.meta.clientId, data: ws.meta.presence });
    } else if (msg.type === 'ops' && Array.isArray(msg.ops)) {
      if (role !== 'edit') return ws.send(JSON.stringify({ type: 'error', message: 'Lecture seule' }));
      const accepted = [];
      for (const op of msg.ops) {
        if (!op || typeof op.k !== 'string' || typeof op.t !== 'string' || op.k.length > 120 || op.t.length > 40) continue;
        const cur = room.entries[op.k];
        if (!cur || op.t > cur.t) {
          room.entries[op.k] = { v: op.v ?? null, t: op.t };
          accepted.push({ k: op.k, v: op.v ?? null, t: op.t });
        }
      }
      if (accepted.length) {
        room.dirty = true;
        broadcast(room, ws, { type: 'ops', ops: accepted });
      }
      ws.send(JSON.stringify({ type: 'ack', id: msg.id }));
    } else if (msg.type === 'presence' && ws.meta.clientId) {
      const d = msg.data || {};
      ws.meta.presence = {
        name: String(d.name || '').slice(0, 40),
        color: String(d.color || '#ff4d8d').slice(0, 9),
        selected: Array.isArray(d.selected) ? d.selected.slice(0, 100).map(String) : [],
        time: Number(d.time) || 0,
      };
      broadcast(room, ws, { type: 'presence', clientId: ws.meta.clientId, data: ws.meta.presence });
    }
  });

  ws.on('close', () => {
    room.clients.delete(ws);
    if (ws.meta.clientId) broadcast(room, ws, { type: 'leave', clientId: ws.meta.clientId });
  });
}

const pingInterval = setInterval(() => {
  for (const room of rooms.values()) for (const c of room.clients) if (c.readyState === 1) c.ping();
}, 25000);

async function shutdown() {
  clearInterval(pingInterval);
  await Promise.all([...rooms.values()].map((r) => saveRoom(r).catch(() => {})));
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`Formation Studio server → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
