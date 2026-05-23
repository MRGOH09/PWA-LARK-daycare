const CACHE = 'gantt-shell-v44';
const ASSETS = [
  '/',
  '/index.html',
  '/js/gantt.js?v=attendance-year-v36',
  '/attendance.html',
  '/js/attendance.js?v=standalone-v28',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  const networkFirst = req.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/js/');

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && resp.ok && url.origin === self.location.origin) {
          const copy = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      });
      return networkFirst ? network.catch(() => cached) : cached || network.catch(() => cached);
    })
  );
});
