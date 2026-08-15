/**
 * Config Vite pour la VÉRIFICATION VISUELLE uniquement (dev).
 * Ajoute le mock API à la config de base. Usage :
 *   VITE_ENABLE_MOCKS=1 npx vite --config vite.mock.config.ts
 * Ne jamais utiliser en build/prod.
 */
import { defineConfig } from 'vite';
import baseConfig from './vite.config';
import mockApiPlugin from './vite.mock-plugin';

const base = baseConfig as unknown as {
  plugins?: unknown[];
  server?: Record<string, unknown>;
  build?: Record<string, unknown>;
  test?: Record<string, unknown>;
};

export default defineConfig({
  ...base,
  plugins: [...(base.plugins ?? []), mockApiPlugin()],
  server: {
    ...base.server,
    // Pas de proxy vers le backend : le mock répond directement sur /api.
    proxy: undefined,
  },
});
