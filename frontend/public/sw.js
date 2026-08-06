/* LogiTrack service worker — offline PWA
   - App-shell : « network-first » (toujours recharger les nouvelles versions au connecté)
   - Assets statiques hashed : stale-while-revalidate
   - Cache versionné + purge automatique des vieilles versions
*/
const VERSION = 'logitrack-v3';
const APP_SHELL = '/';
const CACHE_URLS = [APP_SHELL, '/manifest.json', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(CACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isStatic(request) {
  const url = new URL(request.url);
  // Chiffré hashed par Vite (/assets/...) ; ignore zone d'API/socket
  return request.method === 'GET' &&
    url.origin === self.location.origin &&
    url.pathname !== '/socket.io/' &&
    !url.pathname.startsWith('/api');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' && request.method !== 'HEAD') return;
  if (!isStatic(request)) return;

  const url = new URL(request.url);
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(APP_SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(APP_SHELL))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});