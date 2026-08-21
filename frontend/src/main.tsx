import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initSentry } from './services/monitoring/sentry';
import { initNativeOAuthListener } from './services/native/nativeAuth';
import { initApiOverrideBanner } from './services/api/config';
import { resetServiceWorkerAndReload } from './services/pwa/reset';

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
//
// + Auto-guérison accélérée : si le SW contrôlait la page (hadControllerAtLoad) ET
//   qu'aucun ping de version n'a été reçu sous 3s, le reset forcé est déclenché
//   IMMÉDIATEMENT (sans attendre RELOAD_COOLDOWN_MS) sur le 1er chunk-404.



function isChunkFailure(event: ErrorEvent): boolean {
  const msg = String(event.message || '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Failed to load module script') ||
    (event.target instanceof HTMLLinkElement && event.target.href?.includes('/assets/'))
  );
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

    // --- Auto-guérison accélérée ---
    // Si le SW contrôlait la page AVANT le chargement ET qu'aucun ping de version
    // n'a été reçu sous 3s, on force le reset IMMÉDIATEMENT sans attendre le cooldown.
    // On ne le fait QU'UNE SEULE FOIS par version (compteur localStorage).
    if (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      !navigator.serviceWorker.controller // Le SW a été purgé ou n'a jamais pris le contrôle
    ) {
      // Cas normal : le SW est déjà parti, on suit le chemin standard
    }

    // Vérification du compteur persistant par version pour auto-guérison accélérée
    const swVersionKey = 'dt_sw_known_version';
    const swForceResetPrefix = 'dt_sw_force_reset_done_v';
    const knownVersion = localStorage.getItem(swVersionKey);

    // Si on détecte un chunk-404 et que le SW avait le contrôle au chargement,
    // et que le cooldown n'est pas atteint mais on veut accélérer :
    // La variable globale hadControllerAtLoad est dans le scope du if ci-dessus.
    // On ne peut pas y accéder ici, donc on utilise une approche différente :
    // on regarde si sessionStorage a déjà un dt_chunk_reload très récent (< 3s).
    // Si oui ET qu'on a un knownVersion, on tente le reset forcé accéléré.

    // Si le premier reload a eu lieu il y a < 3s (donc le chunk-404 est le 1er ou 2e)
    // ET qu'on a une version connue, on tente le reset forcé immédiat.
    const timeSinceLastReload = now - lastReload;
    if (
      knownVersion &&
      timeSinceLastReload < SW_PING_TIMEOUT_MS && // Reload très récent (< 3s) → auto-guérison accélérée
      timeSinceLastReload > 0 // Pas le tout premier échec
    ) {
      const forceResetKey = `${swForceResetPrefix}${knownVersion}`;
      if (localStorage.getItem(forceResetKey) !== '1') {
        localStorage.setItem(forceResetKey, '1');
        sessionStorage.setItem(SW_RESET_KEY, String(now));
        console.warn(
          `[app] Auto-guérison accélérée : chunk-404 après reload récent, reset forcé du SW (version ${knownVersion})`,
        );
        void resetServiceWorkerAndReload();
        return;
      }
    }

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
