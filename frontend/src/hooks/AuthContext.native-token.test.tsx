import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import type { User } from '../types';

// =============================================================================
// Pont du credential vers le worker natif de tracking.
//
// RÉGRESSION COUVERTE ICI (audit 2026-08-27, panne terrain) : le natif recevait
// l'ACCESS TOKEN (15 min), renouvelable uniquement par le JS. En veille, la
// WebView est gelée : passé 15 min le worker natif n'avait plus de credential
// valide et cessait SILENCIEUSEMENT d'envoyer les positions accumulées.
// login() doit donc pousser le DEVICE TOKEN longue durée (30 j) obtenu via
// POST /auth/device-token — et JAMAIS l'access token.
// =============================================================================

const { mockSetNativeAuthToken, mockFlushNativeCookies, mockApiPost, mockDisconnectSocket } = vi.hoisted(() => ({
  mockSetNativeAuthToken: vi.fn(),
  mockFlushNativeCookies: vi.fn(),
  mockApiPost: vi.fn(),
  mockDisconnectSocket: vi.fn(),
}));

vi.mock('../services/tracking/backgroundLocation', () => ({
  setNativeAuthToken: mockSetNativeAuthToken,
  flushNativeCookies: mockFlushNativeCookies,
}));

vi.mock('../services/api/client', () => ({
  default: {
    post: mockApiPost,
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));
vi.mock('../services/api/csrf', () => ({
  fetchCsrfToken: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/auth/refreshToken', () => ({
  refreshAccessTokenOutcome: vi.fn().mockResolvedValue({ token: null, reason: 'expired' }),
}));
vi.mock('../services/socket/socket', () => ({
  disconnectSocket: mockDisconnectSocket,
}));
vi.mock('../services/monitoring/sentry', () => ({
  setSentryUser: vi.fn(),
}));

/** JWT synthétique valide (header.payload.signature) avec un claim exp exploitable. */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

function TestComponent({ onReady }: { onReady: (login: ReturnType<typeof useAuth>['login']) => void }) {
  const { login } = useAuth();
  onReady(login);
  return null;
}

const ACCESS_TOKEN = makeJwt({
  sub: 'user-1',
  email: 'driver@test.com',
  role: 'driver',
  companyId: 'company-1',
  exp: Math.floor(Date.now() / 1000) + 900, // +15 min — volontairement court
});

const USER: User = {
  id: 'user-1',
  email: 'driver@test.com',
  firstName: 'Jean',
  lastName: 'Rakoto',
  role: 'driver',
  companyId: 'company-1',
};

async function renderAndLogin(accessToken = ACCESS_TOKEN) {
  let loginFn: ReturnType<typeof useAuth>['login'] = () => {};
  render(
    <AuthProvider>
      <TestComponent onReady={(l) => { loginFn = l; }} />
    </AuthProvider>,
  );
  await act(async () => {
    loginFn(USER, accessToken);
  });
}

describe('AuthContext — credential longue durée poussé au worker natif', () => {
  beforeEach(() => {
    mockSetNativeAuthToken.mockClear();
    mockFlushNativeCookies.mockClear();
    mockApiPost.mockReset();
    mockDisconnectSocket.mockClear();
    localStorage.clear();
  });

  it("RÉGRESSION (audit 2026-08-27, HAUTE) : login() force un socket neuf (disconnectSocket) — sinon une reconnexion manuelle sans redémarrage complet de l'app garde le flag interne sessionExpired bloqué à true, empêchant TOUTE reconnexion automatique malgré le nouveau token valide", async () => {
    mockApiPost.mockResolvedValue({
      data: { deviceToken: 'device-token', expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 },
    });

    await renderAndLogin();

    expect(mockDisconnectSocket).toHaveBeenCalledTimes(1);
  });

  it('login() récupère le device token (30 j) et le pousse au natif', async () => {
    const deviceToken = 'device-token-longue-duree';
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    mockApiPost.mockResolvedValue({ data: { deviceToken, expiresAt } });

    await renderAndLogin();

    await waitFor(() => expect(mockSetNativeAuthToken).toHaveBeenCalledTimes(1));
    expect(mockApiPost).toHaveBeenCalledWith('/auth/device-token');
    expect(mockSetNativeAuthToken).toHaveBeenCalledWith(deviceToken, expiresAt);
  });

  it("ne pousse JAMAIS l'access token court au natif (régression : arrêt d'envoi en veille)", async () => {
    const deviceToken = 'device-token-longue-duree';
    mockApiPost.mockResolvedValue({
      data: { deviceToken, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 },
    });

    await renderAndLogin();

    await waitFor(() => expect(mockSetNativeAuthToken).toHaveBeenCalled());
    for (const call of mockSetNativeAuthToken.mock.calls) {
      expect(call[0]).not.toBe(ACCESS_TOKEN);
    }
  });

  it("n'écrit rien au natif si le serveur ne renvoie pas de device token exploitable", async () => {
    mockApiPost.mockResolvedValue({ data: { deviceToken: '', expiresAt: 'pas-un-nombre' } });

    await renderAndLogin();

    await waitFor(() => expect(mockApiPost).toHaveBeenCalled());
    expect(mockSetNativeAuthToken).not.toHaveBeenCalled();
  });

  it("n'échoue pas et ne bloque pas le login si /auth/device-token est injoignable", async () => {
    mockApiPost.mockRejectedValue(new Error('network down'));

    await renderAndLogin();

    await waitFor(() => expect(mockApiPost).toHaveBeenCalled());
    expect(mockSetNativeAuthToken).not.toHaveBeenCalled();
    // Le flush cookie (autre effet de login) a bien eu lieu : l'échec réseau du
    // device token n'interrompt pas la séquence de connexion.
    expect(mockFlushNativeCookies).toHaveBeenCalled();
  });
});
