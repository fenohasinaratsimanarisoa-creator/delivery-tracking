import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initSentry } from './services/monitoring/sentry';
import { initNativeOAuthListener } from './services/native/nativeAuth';
import { initApiOverrideBanner } from './services/api/config';
import { resetServiceWorkerAndReload } from './services/pwa/reset';
import { isChunkLoadError, recoverFromChunkLoadError } from './services/pwa/chunkRecovery';

initSentry();
initNativeOAuthListener();
initApiOverrideBanner();

// Clés de stockage pour la gestion du rechargement et du reset SW
const RELOAD_KEY = 'dt_chunk_reload';
const SW_RESET_KEY = 'dt_sw_reset';
const RELOAD_COOLDOWN_MS = 10_000;
const SW_PING_TIMEOUT_MS = 3_000;

if ('serviceWorker' in navigator) {
  // Vrai uniquement si la page a été chargée alors qu'un service worker contrôlait
  // déjà la navigation : permet d'ignorer le premier contrôle (première visite, rien
  // de périmé en mémoire) et de ne recharger que lors d'un changement de version
  // ultérieur (nouveau déploiement).
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  let swSwitched = false;

  // Reload contrôlé unique quand un nouveau service worker (nouveau déploiement) prend
  // le contrôle, pour ne pas tourner avec l'ancien bundle JS en mémoire. Anti-boucle :
  // ignoré si un reload (toute cause) a eu lieu il y a moins de 10 s.
  const reloadOnSwUpdate = (reason: string) => {
    const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - lastReload > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      console.warn(`[app] ${reason} — rechargement de l'app`);
      window.location.reload();
    }
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtLoad || swSwitched) return;
    swSwitched = true;
    reloadOnSwUpdate('nouveau service worker actif');
  });

  // --- Auto-guérison SW orphelin ---
  // Le SW envoie SW_UPDATED / SW_VERSION_PING à l'activate. On compare la version
  // reçue avec la version connue en localStorage. Si mismatch OU pas de réponse sous 3s
  // ET qu'un chunk-404 survient → reset forcé IMMÉDIAT (sans attendre RELOAD_COOLDOWN_MS).
  // Compteur persistant (localStorage, pas sessionStorage) par version de SW pour ne
  // déclencher le reset QU'UNE SEULE FOIS par version.
  const SW_VERSION_KEY = 'dt_sw_known_version';
  const SW_FORCE_RESET_PREFIX = 'dt_sw_force_reset_done_v';

  let activeSwVersion: string | null = null;
  let swVersionPingReceived = false;

  // --- Détection accélérée : SW orphelin sans ping de version ---
  // Si le SW contrôlait déjà la page et qu'aucun ping n'est reçu sous 3s,
  // le SW est potentiellement orphelin. Le flag sert dans le handler d'erreur
  // chunk pour décider du reset immédiat.
  if (hadControllerAtLoad) {
    setTimeout(() => {
      if (!swVersionPingReceived) {
        console.warn(
          '[app] Aucun ping de version SW reçu après 3s — SW potentiellement orphelin',
        );
      }
    }, SW_PING_TIMEOUT_MS);
  }

  // Réponse au ping de version du SW : on signale notre version connue.
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event.data;
    if (!data) return;

    if (data.type === 'SW_UPDATED' || data.type === 'SW_VERSION_PING') {
      const swVer = data.version as string | undefined;
      swVersionPingReceived = true;

      if (data.type === 'SW_VERSION_PING' && navigator.serviceWorker.controller) {
        // Le client signale au SW sa version perçue pour comparaison
        navigator.serviceWorker.controller.postMessage({
          type: 'SW_CLIENT_VERSION_REPORT',
          version: localStorage.getItem(SW_VERSION_KEY) || '',
        });
      }

      if (swVer) {
        activeSwVersion = swVer;
        localStorage.setItem(SW_VERSION_KEY, swVer);
      }

      // Si le SW signale une mismatch (SW_FORCE_RESET), on reset immédiat
      if (data.type === 'SW_UPDATED' && hadControllerAtLoad) {
        reloadOnSwUpdate('nouvelle version du service worker (SW_UPDATED)');
      }
    }

    if (data.type === 'SW_FORCE_RESET') {
      const reason = data.reason || 'unknown';
      console.warn(`[app] SW_FORCE_RESET reçu : ${reason}`);

      // Vérifier le compteur persistant pour ne pas boucler
      const ver = activeSwVersion || 'unknown';
      const forceResetKey = `${SW_FORCE_RESET_PREFIX}${ver}`;
      if (localStorage.getItem(forceResetKey) === '1') {
        console.warn(`[app] SW_FORCE_RESET déjà exécuté pour la version ${ver}, ignoré`);
        return;
      }
      localStorage.setItem(forceResetKey, '1');
      sessionStorage.setItem(SW_RESET_KEY, String(Date.now()));
      console.warn(`[app] Reset forcé du service worker (version ${ver}) — purge + reload`);
      void resetServiceWorkerAndReload();
    }
  });



  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

// Rechargement automatique quand un chunk Vite hashed est introuvable (404) : survient
// quand le serveur redéploie pendant une session — le navigateur garde l'ancien
// index.html qui référence des chunks supprimés (CHAQUE page de l'app est
// lazy-loadée, voir App.tsx, et son chunk change de hash à CHAQUE build même si
// son propre code source n'a pas changé, car le bundle partagé change).
//
// Ce listener ne couvre que la moitié des cas : l'échec de chargement du
// <script>/<link> lui-même (remonte comme un vrai `error` DOM). L'AUTRE cas,
// bien plus fréquent en pratique — l'`import()` dynamique d'une page
// React.lazy() qui échoue PENDANT LE RENDU — ne passe jamais par ici, il est
// intercepté par ErrorBoundary (voir components/ErrorBoundary.tsx), qui
// appelle le même recoverFromChunkLoadError() ci-dessous.
//
// Capture = true : les erreurs de ressources (<link> CSS des chunks lazy qui 404
// après redéploiement) ne "bubblent" pas jusqu'à window, il faut les capter à la
// phase de capture pour déclencher le même chemin de récupération.
window.addEventListener(
  'error',
  (event) => {
    const isLinkAssetFailure =
      event.target instanceof HTMLLinkElement && Boolean(event.target.href?.includes('/assets/'));
    if (!isChunkLoadError(event.message) && !isLinkAssetFailure) return;
    recoverFromChunkLoadError(`chunk introuvable (${event.message || 'resource error'})`);
  },
  true,
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
