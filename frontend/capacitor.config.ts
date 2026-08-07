import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.logitrack.app',
  appName: 'LogiTrack',
  webDir: 'dist',
  // Mode « app = site web » : le WebView charge le site déployé tel quel.
  // Same-origin → login (dont Google OAuth), cookies, websockets, GPS,
  // notifications live… tout fonctionne exactement comme le site web.
  server: {
    url: 'https://deliverytrack-web.onrender.com',
    cleartext: false,
    // Liste blanche des hôtes que la WebView peut charger. Tout autre domaine
    // (lien <a> ou navigation utilisateur) est bloqué dans la WebView et rouvert
    // dans le navigateur système par Capacitor (Bridge.launchIntent).
    // Le domaine de l'app est déjà autorisé via server.url, mais on le liste
    // explicitement par sécurité/défense en profondeur.
    // NB : la navigation JS (window.location.href) vers un domaine externe
    // échappe à ce garde — les flux externes (checkout Stripe…) utilisent
    // @capacitor/browser (custom tab) dans l'app native.
    allowNavigation: ['deliverytrack-web.onrender.com'],
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
  },
};

export default config;