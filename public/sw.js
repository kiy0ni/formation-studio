// Offline support. The cache name and precache list below are filled in at build time (vite.config.ts).
// named after its own address: the copy still served at the old address (/formation-studio/) must not delete this one's files, nor the reverse
const PREFIX = `lineup:${new URL(self.registration.scope).pathname}:`;
const CACHE = PREFIX + '__BUILD__';
const PRECACHE = "__PRECACHE__";
const url = (path) => new URL(path, self.registration.scope).href;
const SHELL = ['./', 'index.html', 'icon.svg', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const files = [...SHELL, ...(Array.isArray(PRECACHE) ? PRECACHE : [])].map(url);
      await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => (k.startsWith(PREFIX) && k !== CACHE) || k.startsWith('formation-studio-')).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== location.origin || u.pathname.includes('/api/') || u.pathname.endsWith('/ws')) return;

  // pages: network first (to get updates), cached copy when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          // slow network: the cached copy after 3 s rather than a blank screen
          const res = await Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))]);
          if (res.ok) (await caches.open(CACHE)).put(url('index.html'), res.clone());
          return res;
        } catch {
          return (await caches.match(url('index.html'))) || Response.error();
        }
      })(),
    );
    return;
  }

  // hashed assets & icons: cache first
  event.respondWith(
    (async () => {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && u.pathname.startsWith(new URL(self.registration.scope).pathname)) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});
