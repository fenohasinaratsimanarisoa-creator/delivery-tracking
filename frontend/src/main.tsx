import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initSentry } from './services/monitoring/sentry';
import { initNativeOAuthListener } from './services/native/nativeAuth';

initSentry();
initNativeOAuthListener();

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

  // Message posté par sw.js (handler activate, après clients.claim()) quand une
  // nouvelle version a pris le contrôle.
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type !== 'SW_UPDATED' || !hadControllerAtLoad) return;
    reloadOnSwUpdate('nouvelle version du service worker (SW_UPDATED)');
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

// Rechargement automatique quand un chunk Vite hashed est introuvable (404) : survient
// quand Render redéploie pendant une session — le navigateur garde l'ancien index.html
// qui référence des chunks supprimés. L'import dynamique échoue → on recharge la page
// pour récupérer le nouvel index.html.
//
// Garde anti-boucle persistée (horodatage en sessionStorage, par onglet) :
//   1er échec                → reload simple (horodaté dans 'dt_chunk_reload')
//   2e échec (< 10 s)        → l'ancien SW resert le vieux shell : désenregistrement
//                              des service workers + purge des caches + reload UNE fois
//                              (horodaté dans 'dt_sw_reset')
//   3e échec                 → échec loggé clairement, on arrête (pas de boucle infinie)
const RELOAD_KEY = 'dt_chunk_reload';
const SW_RESET_KEY = 'dt_sw_reset';
const RELOAD_COOLDOWN_MS = 10_000;

function isChunkFailure(event: ErrorEvent): boolean {
  const msg = String(event.message || '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Failed to load module script') ||
    (event.target instanceof HTMLLinkElement && event.target.href?.includes('/assets/'))
  );
}

async function resetServiceWorkerAndReload(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
      console.warn(`[app] ${registrations.length} service worker(s) désenregistré(s)`);
    }
  } catch (err) {
    console.error('[app] échec du désenregistrement du service worker', err);
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      console.warn(`[app] ${keys.length} cache(s) purgé(s)`);
    }
  } catch (err) {
    console.error('[app] échec de la purge des caches', err);
  }
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  window.location.reload();
}

// Capture = true : les erreurs de ressources (ex. <link> CSS des chunks lazy qui 404
// après redéploiement) ne "bubbent" pas jusqu'à window, il faut les capter à la phase
// de capture pour déclencher le même chemin de récupération.
window.addEventListener(
  'error',
  (event) => {
    if (!isChunkFailure(event)) return;

    const now = Date.now();
    const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    const lastSwReset = Number(sessionStorage.getItem(SW_RESET_KEY) || 0);

    if (now - lastReload > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_KEY, String(now));
      console.warn('[app] chunk périmé détecté — rechargement de l\'app');
      window.location.reload();
      return;
    }

    // Un reload a déjà eu lieu il y a moins de 10 s et le chunk manque toujours :
    // l'ancien service worker resert le vieux shell. Si on est vraiment hors-ligne,
    // NE PAS détruire le SW/caches (le mode offline en dépend) : on s'arrête là.
    if (!navigator.onLine) {
      console.warn(
        '[app] hors-ligne : chunk indisponible en cache — rechargements et nettoyage service worker désactivés (mode offline préservé)',
      );
      return;
    }
    // En ligne : le redéploiement a remplacé les chunks, l'ancien SW resert un vieux
    // shell. On le désenregistre, on purge les caches, puis on recharge une seule fois.
    if (now - lastSwReset > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(SW_RESET_KEY, String(now));
      console.warn(
        '[app] chunk toujours périmé après reload — désenregistrement du service worker et purge des caches',
      );
      void resetServiceWorkerAndReload();
      return;
    }

    // 3e échec : reload + reset n'ont rien changé. On abandonne pour ne pas boucler.
    console.error(
      '[app] ÉCHEC : chunk introuvable persistant malgré reload + reset du service worker — rechargements stoppés',
    );
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
