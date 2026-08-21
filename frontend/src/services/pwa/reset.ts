/**
 * Reset complet du service worker : désenregistrement + purge des caches + reload.
 * Utilisé par main.tsx (auto-guérison SW orphelin) et LoginPage.tsx (bouton de reset manuel).
 */
export async function resetServiceWorkerAndReload(): Promise<void> {
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
  sessionStorage.setItem('dt_chunk_reload', String(Date.now()));
  window.location.reload();
}
