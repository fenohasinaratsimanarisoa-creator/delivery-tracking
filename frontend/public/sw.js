// Service Worker désactivé pendant le développement.
// Le cache-first empêchait le rechargement des nouvelles versions.
// À réactiver en production avec versionnage automatique.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => self.clients.claim());
