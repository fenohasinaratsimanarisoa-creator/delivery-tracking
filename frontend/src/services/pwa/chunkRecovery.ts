import { resetServiceWorkerAndReload } from './reset';

/**
 * Un chunk Vite (route lazy-loadée, cf. App.tsx) devenu introuvable après un
 * redéploiement se manifeste par DEUX chemins totalement différents côté
 * navigateur, et seul le premier était géré avant ce correctif :
 *
 * 1. Échec de chargement du <script> d'ENTRÉE (index-*.js) ou d'un <link>
 *    CSS : remonte comme un vrai événement `window.onerror` / `error` sur la
 *    ressource — géré par le listener dans main.tsx.
 * 2. Échec d'un `import()` dynamique déclenché par `React.lazy()` (TOUTE
 *    page de ce projet est lazy-loadée, voir App.tsx) : la promesse rejetée
 *    est levée par React PENDANT LE RENDU et attrapée par le plus proche
 *    ErrorBoundary (getDerivedStateFromError/componentDidCatch) — elle
 *    n'atteint JAMAIS `window.onerror`. C'est le cas le plus fréquent en
 *    pratique : un onglet resté ouvert avant un déploiement navigue vers une
 *    page qu'il n'a pas encore chargée, dont le chunk (hashé, changeant à
 *    CHAQUE build même pour une page non modifiée — le bundle est partagé)
 *    n'existe plus sur le serveur. Avant ce fichier, ErrorBoundary affichait
 *    un écran d'erreur statique dont le bouton "Réessayer" relançait le
 *    MÊME rendu en échec (boucle visuelle : la page reste bloquée).
 *
 * Ce module centralise la détection + la récupération (reload, puis reset
 * complet du service worker si ça persiste) pour que les DEUX chemins
 * déclenchent la même guérison, avec le même anti-boucle (cooldown partagé
 * en sessionStorage) qu'avant.
 */

const RELOAD_KEY = 'dt_chunk_reload';
const SW_RESET_KEY = 'dt_sw_reset';
const RELOAD_COOLDOWN_MS = 10_000;

export function isChunkLoadError(message: string | null | undefined): boolean {
  const msg = String(message || '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Failed to load module script') ||
    // Safari
    msg.includes('Importing a module script failed') ||
    // Certains navigateurs remontent juste "Load failed" pour un import() en échec
    (msg.includes('Load failed') && msg.length < 40)
  );
}

/**
 * Séquence identique à celle déjà en place pour les erreurs `window.onerror` :
 * 1er échec → simple reload ; échec persistant (< 10s après) → désenregistrement
 * du service worker + purge des caches + reload ; au-delà, on abandonne (log
 * clair) plutôt que de boucler indéfiniment.
 */
export function recoverFromChunkLoadError(reason: string): void {
  const now = Date.now();
  const lastReload = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  const lastSwReset = Number(sessionStorage.getItem(SW_RESET_KEY) || 0);

  if (now - lastReload > RELOAD_COOLDOWN_MS) {
    sessionStorage.setItem(RELOAD_KEY, String(now));
    console.warn(`[app] ${reason} — rechargement de l'app`);
    window.location.reload();
    return;
  }

  if (!navigator.onLine) {
    console.warn(
      `[app] ${reason}, mais hors-ligne — rechargement et reset du service worker désactivés (mode offline préservé)`,
    );
    return;
  }

  if (now - lastSwReset > RELOAD_COOLDOWN_MS) {
    sessionStorage.setItem(SW_RESET_KEY, String(now));
    console.warn(`[app] ${reason} après un reload récent — reset complet du service worker`);
    void resetServiceWorkerAndReload();
    return;
  }

  console.error(
    `[app] ÉCHEC : ${reason} persistant malgré reload + reset du service worker — rechargements stoppés`,
  );
}
