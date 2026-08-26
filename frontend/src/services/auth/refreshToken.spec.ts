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

  it('403 CSRF (2× consécutifs) → reason "network" — JAMAIS de déconnexion (jeton CSRF obsolète, transitoire)', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    // Le premier 403 déclenche un retry CSRF (re-fetch + re-tentative) ;
    // si le retry échoue aussi, reason = 'network' (pas de déconnexion).
    axiosPost
      .mockRejectedValueOnce({ response: { status: 403, data: { message: 'Invalid CSRF token' } }, request: {} })
      .mockRejectedValueOnce({ response: { status: 403, data: { message: 'Invalid CSRF token' } }, request: {} });
    const outcome = await refreshAccessTokenOutcome();
    expect(outcome.token).toBeNull();
    expect(outcome.reason).toBe('network');
  });

  it('429 throttle → reason "network" — JAMAIS de déconnexion (pic réseau mobile)', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    axiosPost.mockRejectedValueOnce({ response: { status: 429 }, request: {} });
    const outcome = await refreshAccessTokenOutcome();
    expect(outcome.reason).toBe('network');
  });

  it('500 serveur (down Render/Postgres, cold start) → reason "network" — JAMAIS de déconnexion', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    axiosPost.mockRejectedValueOnce({ response: { status: 503 }, request: {} });
    const outcome = await refreshAccessTokenOutcome();
    expect(outcome.reason).toBe('network');
    expect(setAccessTokenMock).not.toHaveBeenCalled();
  });

  it('403 CSRF + retry CSRF réussi → token obtenu sans déconnexion (le retry intercepte le blip)', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    // Le premier 403 déclenche un retry CSRF ; le retry réussit.
    axiosPost
      .mockRejectedValueOnce({ response: { status: 403 }, request: {} })
      .mockResolvedValueOnce({ data: { accessToken: 'token-apres-retry' } });
    const outcome = await refreshAccessTokenOutcome();
    expect(outcome.token).toBe('token-apres-retry');
    expect(outcome.reason).toBe('expired'); // reason est toujours 'expired' sur succès
    expect(axiosPost).toHaveBeenCalledTimes(2); // 1 échoué + 1 retry réussi
  });

  it('403 CSRF (retry échoué) + le refresh suivant repart bien (verrou libéré)', async () => {
    const { refreshAccessTokenOutcome } = await import('./refreshToken');
    // Les deux tentatives échouent (403 × 2)
    axiosPost
      .mockRejectedValue({ response: { status: 403 }, request: {} });
    const first = await refreshAccessTokenOutcome();
    // Verrou libéré après l'échec, le refresh suivant repart
    axiosPost.mockResolvedValueOnce({ data: { accessToken: 'token-apres-blip' } });
    const second = await refreshAccessTokenOutcome();
    expect(first.reason).toBe('network');
    expect(second.token).toBe('token-apres-blip');
  });

  describe('verrou inter-onglets (Web Locks API)', () => {
    // Le verrou refreshPromise ne déduplique que DANS un même onglet (module JS
    // par onglet). Avec 3+ onglets qui rafraîchissent à quelques ms d'écart en
    // tenant tous le même cookie pré-rotation, le backend ne tolère qu'un seul
    // niveau d'historique (refresh_token_hash + previous_refresh_token_hash) —
    // le 3e onglet ne correspond à aucun des deux → "REUSE detected" → session
    // entière révoquée. navigator.locks sérialise les appels réseau à travers
    // TOUS les onglets de l'origine pour éliminer cette course.
    afterEach(() => {
      // @ts-expect-error -- nettoyage du mock installé sur navigator dans ce bloc
      delete globalThis.navigator?.locks;
    });

    it("passe par navigator.locks.request() quand l'API est disponible, avec le nom de verrou dédié", async () => {
      const lockRequest = vi.fn((_name: string, cb: () => Promise<unknown>) => cb());
      vi.stubGlobal('navigator', { locks: { request: lockRequest } });

      const { refreshAccessTokenOutcome } = await import('./refreshToken');
      const outcome = await refreshAccessTokenOutcome();

      expect(lockRequest).toHaveBeenCalledTimes(1);
      expect(lockRequest.mock.calls[0][0]).toBe('dt-auth-refresh');
      expect(outcome.token).toBe('token-new');
      expect(axiosPost).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it('deux refresh concurrents inter-onglets simulés (verrou qui met la 2e tentative en file) → un seul appel réseau', async () => {
      // Simule le comportement réel de navigator.locks : la 2e demande attend que
      // le callback de la 1re se termine avant de démarrer la sienne.
      const gate: { release: (() => void) | null } = { release: null };
      let firstRequestSeen = false;
      const lockRequest = vi.fn(async (_name: string, cb: () => Promise<unknown>) => {
        if (!firstRequestSeen) {
          firstRequestSeen = true;
          // 1re demande : on retarde son exécution pour garder le verrou "tenu"
          // pendant que la 2e demande arrive et doit attendre.
          await new Promise<void>((resolve) => { gate.release = () => resolve(); });
        }
        return cb();
      });
      vi.stubGlobal('navigator', { locks: { request: lockRequest } });

      const { refreshAccessTokenOutcome } = await import('./refreshToken');
      const p1 = refreshAccessTokenOutcome();
      const p2 = refreshAccessTokenOutcome();
      gate.release?.();
      await Promise.all([p1, p2]);

      // Le verrou en mémoire (refreshPromise) dédup déjà ces deux appels DANS ce
      // même onglet — ce test documente que le chemin passe bien par le verrou
      // cross-tab en plus, sans appel réseau dupliqué.
      expect(axiosPost).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    });

    it("sans navigator.locks (Safari < 15.4, vieux WebView) : repli silencieux, comportement inchangé", async () => {
      vi.stubGlobal('navigator', {});
      const { refreshAccessTokenOutcome } = await import('./refreshToken');
      const outcome = await refreshAccessTokenOutcome();
      expect(outcome.token).toBe('token-new');
      expect(axiosPost).toHaveBeenCalledTimes(1);
      vi.unstubAllGlobals();
    });
  });
});