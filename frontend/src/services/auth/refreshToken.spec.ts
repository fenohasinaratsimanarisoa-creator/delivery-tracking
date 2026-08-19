import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// VERROU UNIQUE DE REFRESH JWT (Audit robustesse GPS — Prompt 1).
//
// Contrat vérifié : l'intercepteur 401 réactif d'api/client.ts et le
// rafraîchissement proactif du socket (socket.ts) partagent DÉSORMAIS le même
// refreshPromise (refreshToken.ts). Deux refresh déclenchés presque
// simultanément ne doivent produire qu'UN SEUL appel réseau /auth/refresh —
// sinon le backend (auth.service.ts, méthode refresh(), détection "REUSE
// detected (possible theft)") révoque la session entière et force une
// reconnexion (~toutes les 5 min en usage réel : le socket rafraîchit
// proactivement pendant que l'intercepteur 401 rafraîchit réactivement).
// =============================================================================

const axiosPost = vi.fn();
const axiosGet = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: (...args: unknown[]) => axiosPost(...args),
    get: (...args: unknown[]) => axiosGet(...args),
  },
}));

vi.mock('../api/csrf', () => ({
  fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
  getCsrfHeaders: vi.fn().mockReturnValue({ 'X-CSRF-Token': 'csrf-t', 'X-CSRF-HMAC': 'csrf-h' }),
}));

const setAccessTokenMock = vi.fn();
vi.mock('./tokenStore', () => ({
  setAccessToken: (...args: unknown[]) => setAccessTokenMock(...args),
}));

vi.mock('../api/config', () => ({
  getApiBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

describe('refreshToken.ts — verrou de déduplication unique du refresh JWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosPost.mockResolvedValue({ data: { accessToken: 'token-new' } });
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('un 401 REST + un refresh proactif du socket à quelques ms d\'intervalle → UN SEUL appel /auth/refresh', async () => {
    const { refreshAccessToken, refreshAccessTokenOutcome } = await import('./refreshToken');

    // Entrée 1 : intercepteur Axios (401 sur une requête REST, rafraîchissement réactif).
    const restOutcome = refreshAccessTokenOutcome();
    // Entrée 2 : timer proactif du socket, "quelques ms" plus tard.
    const socketToken = refreshAccessToken();

    const [outcome, token] = await Promise.all([restOutcome, socketToken]);

    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost.mock.calls[0][0]).toBe('http://localhost:3000/auth/refresh');
    expect(token).toBe('token-new');
    expect(outcome.token).toBe('token-new');
    expect(setAccessTokenMock).toHaveBeenCalledWith('token-new');
  });

  it('un refresh terminé libère le verrou : le refresh suivant part bien en réseau', async () => {
    const { refreshAccessToken } = await import('./refreshToken');
    await refreshAccessToken();
    await refreshAccessToken();
    expect(axiosPost).toHaveBeenCalledTimes(2);
  });

  it('échec réseau (timeout, cold start serveur) → token null avec reason "network" (pas de déconnexion forcée)', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    axiosPost.mockRejectedValueOnce({ code: 'ECONNABORTED', request: {} });
    const outcome = await refreshAccessTokenOutcome();
    expect(outcome.token).toBeNull();
    expect(outcome.reason).toBe('network');
    expect(setAccessTokenMock).not.toHaveBeenCalled();
  });

  it('rejet serveur (401) → token null avec reason "expired" (session réellement expirée)', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    axiosPost.mockRejectedValueOnce({ response: { status: 401 }, request: {} });
    const outcome = await refreshAccessTokenOutcome();
    expect(outcome.token).toBeNull();
    expect(outcome.reason).toBe('expired');
  });
});