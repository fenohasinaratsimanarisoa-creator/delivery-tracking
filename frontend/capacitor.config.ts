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
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;