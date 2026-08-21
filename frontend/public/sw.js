/* LogiTrack service worker — offline PWA
   - App-shell : « network-first » (toujours recharger les nouvelles versions au connecté)
   - Assets statiques hashed : stale-while-revalidate
   - Cache versionné + purge automatique des vieilles versions
   - Auto-guérison : ping de version à l'activate pour débloquer les clients coincés
     sur un ancien SW (unregister forcé via SW_FORCE_RESET)
*/
const VERSION = 'logitrack-v4'; // À bump à chaque déploiement
const APP_SHELL = '/';
const CACHE_URLS = [APP_SHELL, '/manifest.json', '/icons/icon.svg'];
let consecutiveFallbacks = 0;

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
      .then(() =>
        // Auto-guérison : ping chaque client avec la version active. Le client
        // compare avec sa version connue — si incohérent (SW orphelin), il force
        // unregister + purge + reload via SW_FORCE_RESET.
        self.clients.matchAll().then((clients) =>
          clients.forEach((client) => {
            client.postMessage({ type: 'SW_UPDATED', version: VERSION });
            // Aussi envoyer un ping de version pur : le client répond avec sa
            // version perçue, et le SW peut décider de forcer le reset.
            client.postMessage({ type: 'SW_VERSION_PING', version: VERSION });
          })
        )
      )
  );
});

// Réponse aux pings de version : si le client signale une version différente
// (ou n'a jamais répondu), on lui ordonne un reset complet.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SW_CLIENT_VERSION_REPORT') {
    const clientVersion = data.version;
    // Le client signale une version différente de la nôtre → SW orphelin
    if (clientVersion && clientVersion !== VERSION) {
      event.source.postMessage({
        type: 'SW_FORCE_RESET',
        reason: `version mismatch: client has "${clientVersion}", active is "${VERSION}"`,
      });
    }
  }
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
          if (res.status === 404) {
            // Le déploiement a remplacé l'ancien index.html : ne jamais mettre un 404
            // en cache comme shell. On purge pour forcer le prochain chargement à
            // récupérer le nouveau shell (les chunks de l'ancien sont périmés de toute
            // façon). Même purge que pour les assets statiques (branche non-navigate).
            caches.delete(VERSION).catch(() => {});
            return res;
          }
          consecutiveFallbacks = 0;
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(APP_SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => {
          // Hors-ligne : on sert le shell en cache, mais avec une garde anti-boucle —
          // si le réseau reste KO sur plusieurs navigations, on purge et on laisse le
          // navigateur afficher son erreur au lieu de servir un vieux shell en boucle
          // (vieux shell → vieux chunks → 404 → reload → boucle vers la page de login).
          consecutiveFallbacks += 1;
          if (consecutiveFallbacks > 3) {
            caches.delete(VERSION).catch(() => {});
            return Response.error();
          }
          return caches.match(APP_SHELL);
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      return fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
            return res;
          }
          // Asset introuvable (404) : le déploiement a remplacé les chunks hashed (nouvel
          // index.html). Un vieux chunk en cache ne doit plus être servi — on le purge pour
          // que le prochain chargement du module échoue proprement et déclenche le reload.
          if (res && res.status === 404) {
            caches.delete(VERSION).catch(() => {});
          }
          return res;
        })
        .catch(() => {
          // Hors-ligne : on sert le cache si dispo, sinon l'erreur réseau.
          return cached || Response.error();
        });
    })
  );
});
