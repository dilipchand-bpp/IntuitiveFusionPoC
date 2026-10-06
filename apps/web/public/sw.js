/* The app's service worker (FR-0825). It only does two things: keep the page's own static files so the app opens fast,
 * and show a plain offline page when there is no connection. It never stores anything from /api, so no business data,
 * and nothing a signed-in person sees, is kept on the device by it. */
const CACHE = 'if-shell-v1';
const KEEP = ['/offline.html', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(KEEP))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/')) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).catch(() => caches.match('/offline.html')));
    return;
  }
  if (u.pathname.startsWith('/_next/static/') || u.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(r);
        if (hit) return hit;
        const res = await fetch(r);
        if (res.ok) c.put(r, res.clone());
        return res;
      }),
    );
  }
});
