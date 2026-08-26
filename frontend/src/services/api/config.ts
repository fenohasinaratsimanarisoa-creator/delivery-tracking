/**
 * Configuration de l'URL de base de l'API.
 *
 * Sécurité (audit 21/08/2026) :
 * - En production, l'override localStorage['dt-api-base'] est IGNORÉ par défaut.
 * - Pour le réactiver en production, une DEUXIÈME clé 'dt-allow-api-override' === '1'
 *   doit être présente (double opt-in volontaire). Cela empêche les overrides oubliés
 *   après un debug local/mobile/Capacitor qui casseraient silencieusement le login.
 * - Quand l'override est actif, une bannière rouge visible s'affiche et le log console
 *   indique l'URL utilisée au démarrage.
 */
export function getApiBaseUrl(): string {
  const isProd = typeof import.meta !== 'undefined' && import.meta.env?.PROD === true;
  let override: string | null = null;

  if (typeof localStorage !== 'undefined') {
    override = localStorage.getItem('dt-api-base');

    if (override) {
      if (isProd) {
        // En production : override ignoré sauf double opt-in explicite
        const allowOverride = localStorage.getItem('dt-allow-api-override') === '1';
        if (!allowOverride) {
          console.warn(
            `[api] Production : override dt-api-base ("${override}") IGNORE (ajoutez dt-allow-api-override=1 pour le réactiver)`,
          );
          override = null;
        } else {
          console.warn(
            `[api] ⚠️  DOUBLE OPT-IN PROD : override dt-api-base ACTIF = "${override}" (bannière affichée)`,
          );
        }
      } else {
        console.info(`[api] Dev : override dt-api-base = "${override}"`);
      }
    }
  }

  const baseUrl = override
    ? override.replace(/\/+$/, '')
    : import.meta.env?.VITE_API_URL || '/api';

  // Log de démarrage dans TOUS les cas
  console.info(`[api] Base URL : ${baseUrl}${isProd ? ' (production)' : ' (dev)'}`);

  return baseUrl;
}

/**
 * Affiche une bannière rouge en haut de l'app quand un override dt-api-base
 * est actif (dev ou double opt-in prod). Appelée une seule fois au démarrage.
 */
export function initApiOverrideBanner(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const override = localStorage.getItem('dt-api-base');
  if (!override) return;

  const isProd = import.meta.env?.PROD === true;
  if (isProd && localStorage.getItem('dt-allow-api-override') !== '1') return;

  const banner = document.createElement('div');
  banner.id = 'dt-api-override-banner';
  banner.setAttribute('role', 'alert');
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 99999;
    background: #dc2626;
    color: #fff;
    padding: 8px 16px;
    font-size: 13px;
    font-family: monospace;
    text-align: center;
    font-weight: bold;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `;
  banner.textContent = `⚠️ API Override actif : ${override.replace(/\/+$/, '')}${isProd ? ' (PRODUCTION — double opt-in)' : ' (DEV)'}`;
  document.body.prepend(banner);
}

/**
 * Version ABSOLUE de getApiBaseUrl(), pour les contextes qui ne peuvent pas
 * résoudre une URL relative comme "/api" faute de moteur de rendu HTTP
 * (le worker natif Android — PositionUploadWorker/NativeHttpFallback — reçoit
 * cette valeur via storeNativeFallbackApiUrl et construit lui-même l'URL
 * complète avec HttpURLConnection, sans jamais passer par le navigateur).
 *
 * BUG CORRIGÉ (audit 2026-08-26, confirmé sur appareil réel : 242 positions
 * en attente, 0 jamais synchronisées même après la correction CSRF) :
 * useDriverTracking.ts appelait storeNativeFallbackApiUrl(getSocketBaseUrl())
 * — getSocketBaseUrl() est conçue pour Socket.IO, qui se connecte À LA
 * RACINE de l'origine (nginx route /socket.io sans préfixe /api). Réutilisée
 * ici, elle produisait une URL SANS /api (ex. https://host au lieu de
 * https://host/api) ; le worker natif construisait alors
 * https://host/tracking/positions/native-batch — une route qui n'existe pas
 * côté nginx (seul /api/tracking/... est proxifié vers le backend) →
 * 405 Not Allowed à CHAQUE tentative, confirmé via curl direct sur l'URL
 * exacte construite par le code natif. Aucune position n'a donc jamais pu
 * être synchronisée par ce chemin depuis sa création.
 */
export function getAbsoluteApiBaseUrl(): string {
  const base = getApiBaseUrl();
  if (/^https?:\/\//.test(base)) return base.replace(/\/+$/, '');
  if (typeof window !== 'undefined') {
    return `${window.location.origin.replace(/\/+$/, '')}/${base.replace(/^\/+/, '')}`;
  }
  return base;
}

export function getSocketBaseUrl(): string {
  const base = getApiBaseUrl();
  if (/^https?:\/\//.test(base)) {
    return base.replace(/\/api\/?$/, '').replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined') return window.location.origin;
  return '/';
}
