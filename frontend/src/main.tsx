import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initSentry } from './services/monitoring/sentry';
import { initNativeOAuthListener } from './services/native/nativeAuth';

initSentry();
initNativeOAuthListener();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}

// Rechargement automatique quand un chunk Vite hashed est introuvable (404) : survient
// quand Render redéploie pendant une session — le navigateur garde l'ancien index.html
// qui référence des chunks supprimés. L'import dynamique échoue → on recharge la page
// pour récupérer le nouvel index.html. Garde anti-boucle : un seul reload.
let chunkReloaded = false;
window.addEventListener('error', (event) => {
  const msg = String(event.message || '');
  if (
    !chunkReloaded &&
    (msg.includes('Failed to fetch dynamically imported module') ||
      msg.includes('error loading dynamically imported module') ||
      (event.target instanceof HTMLLinkElement && event.target.href?.includes('/assets/')))
  ) {
    chunkReloaded = true;
    console.warn('[app] chunk périmé détecté — rechargement de l\'app');
    window.location.reload();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
