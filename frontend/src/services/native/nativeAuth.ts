"use client";
import { getApiBaseUrl } from '../api/config';

// localStorage, PAS sessionStorage (audit 2026-08-26) : entre l'ouverture du
// Custom Tab et le retour du deep link, l'utilisateur passe potentiellement
// 10-60s+ sur l'écran de connexion Google, temps largement suffisant pour que
// l'OS (MIUI en particulier) tue le process de l'app en arrière-plan pour
// libérer de la mémoire. sessionStorage ne survit PAS à un kill de process —
// à la réouverture (process neuf), RELAY_KEY était vide, le state ne
// correspondait jamais, et appUrlOpen rejetait le deep link en silence
// (un simple console.warn, invisible pour l'utilisateur) : la connexion
// Google semblait "ne rien faire", sans jamais échouer visiblement. localStorage
// survit au kill de process (persisté sur disque, comme les cookies) — le
// relayId/verifier restent lisibles même après un redémarrage du WebView.
// Sans risque : valeurs à usage unique, effacées par clearOAuthNativeState()
// dès l'échange réussi.
const RELAY_KEY = 'dt_oauth_relay';
const VERIFIER_KEY = 'dt_oauth_verifier';

export const OAUTH_VERIFIER_KEY = VERIFIER_KEY;

export function clearOAuthNativeState(): void {
  try {
    localStorage.removeItem(RELAY_KEY);
    localStorage.removeItem(VERIFIER_KEY);
  } catch {}
}

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && Boolean(
    (window as unknown as { Capacitor?: { isNativePlatform?: boolean } }).Capacitor?.isNativePlatform,
  );
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua);
}

export function isWebView(): boolean {
  if (isNativeApp()) return true;
  if (typeof navigator === 'undefined') return false;
  return /wv|WebView|AppleWebKit\/.+ Mobile\/.*Safari/i.test(navigator.userAgent || '');
}

function randomBase64Url(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let bin = '';
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let bin = '';
  const bytes = new Uint8Array(digest);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Flux OAuth natif sécurisé :
 *  1. génère un verifier PKCE et envoie son challenge au backend (begin),
 *  2. ouvre le custom tab sur /api/auth/google?state=<relayId> (nonce serveur
 *     qui fait l'aller-retour via le paramètre OAuth state de Google),
 *  3. le callback Google renvoie #code=<usage unique>&state=<relayId> (JAMAIS
 *     le JWT de session dans une URL) → relayé à l'app via le custom scheme.
 */
export async function openGoogleOAuthInNative(): Promise<void> {
  const verifier = randomBase64Url(32);
  const codeChallenge = await sha256Base64Url(verifier);
  localStorage.setItem(VERIFIER_KEY, verifier);

  let relayId = '';
  try {
    const res = await fetch(`${getApiBaseUrl()}/auth/oauth/begin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codeChallenge }),
    });
    if (!res.ok) throw new Error(`begin failed: ${res.status}`);
    const data = (await res.json()) as { relayId?: string };
    if (!data.relayId) throw new Error('begin returned no relayId');
    relayId = data.relayId;
    localStorage.setItem(RELAY_KEY, relayId);
  } catch (err) {
    localStorage.removeItem(RELAY_KEY);
    localStorage.removeItem(VERIFIER_KEY);
    throw err;
  }

  const { Browser } = await import('@capacitor/browser');
  // Base résolue (remote VITE_API_URL en mode local-assets, sinon origine courante) :
  // le custom tab doit ouvrir l'API qui détient le state relay (nonce).
  const base = getApiBaseUrl();
  const authUrl = /^https?:\/\//.test(base)
    ? `${base.replace(/\/api\/?$/, '')}/api/auth/google?state=${encodeURIComponent(relayId)}`
    : `${window.location.origin}${base.replace(/\/api\/?$/, '')}/api/auth/google?state=${encodeURIComponent(relayId)}`;
  await Browser.open({ url: authUrl });
}

/** URL du deep link natif — exportée pour permettre un lien <a> cliquable en
 * secours (voir buildRelayDeepLink), en plus de la navigation JS automatique. */
export function buildRelayDeepLink(code: string, state: string): string {
  return `logitrack://auth#code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
}

export function relayTokenToNativeApp(code: string, state: string): void {
  window.location.replace(buildRelayDeepLink(code, state));
}

export function initNativeOAuthListener(): void {
  if (!isNativeApp()) return;
  void import('@capacitor/app').then(({ App }) => {
    void App.addListener('appUrlOpen', (data: { url: string }) => {
      try {
        const url = new URL(data.url);
        // Deux mécanismes de relais possibles (audit 2026-08-26) : le schéma
        // personnalisé logitrack:// (historique, dépend d'un geste utilisateur
        // accepté par Chrome ET d'une relance d'app autorisée par l'OS — pas
        // fiable sur MIUI même avec les bonnes permissions) et l'App Link HTTPS
        // vérifié (frontend/public/.well-known/assetlinks.json + intent-filter
        // autoVerify="true" dans AndroidManifest.xml) — intercepté par Android
        // AVANT même que Chrome charge la page, donc indépendant de ces deux
        // limites. Les deux sont acceptés ici ; le second est désormais le
        // chemin principal (relayTokenToNativeApp cible l'URL https), le premier
        // reste un repli manuel (lien cliquable dans AuthCallbackPage).
        const isLegacyScheme = url.protocol === 'logitrack:';
        const isVerifiedAppLink =
          url.origin === window.location.origin && url.pathname.startsWith('/auth/callback');
        if (!isLegacyScheme && !isVerifiedAppLink) return;

        const params = new URLSearchParams(url.hash.slice(1));
        const code = params.get('code');
        const state = params.get('state');
        const expectedState = localStorage.getItem(RELAY_KEY);

        // Un deep link est rejeté si le state (nonce serveur) est absent ou ne
        // correspond pas à celui émis avant l'ouverture du Browser.open. Le token
        // de l'ancien flux (#accessToken=...) est désormais systématiquement ignoré.
        if (!code || !state || !expectedState || state !== expectedState) {
          console.warn('[nativeAuth] deep link rejeté : state invalide ou token non échangeable');
          return;
        }

        // Ferme le Custom Tab dès réception du deep link : sinon il reste ouvert
        // en arrière-plan (l'utilisateur peut y revenir par erreur, ou croire que
        // la connexion a échoué alors que l'app vient de recevoir le code) —
        // best-effort, non bloquant si @capacitor/browser échoue à fermer.
        void import('@capacitor/browser')
          .then(({ Browser }) => Browser.close())
          .catch(() => {});

        localStorage.removeItem(RELAY_KEY);
        window.location.href =
          `${window.location.origin}/auth/callback#code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      } catch {
        /* malformed deep link — ignore */
      }
    });
  });
}
