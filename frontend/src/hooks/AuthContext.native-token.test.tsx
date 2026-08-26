import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import type { User } from '../types';

// =============================================================================
// Phase 3 — Pont du token d'authentification vers le natif.
//
// Vérifie que login() (state React uniquement, invisible côté natif) pousse
// aussi le token vers PositionUploadWorker (Phase 4, natif) via
// setNativeAuthToken(), avec l'expiration extraite du claim `exp` du JWT —
// sans ce pont, le worker natif n'aurait jamais de token valide quand le JS
// ne tourne pas.
// =============================================================================

const { mockSetNativeAuthToken } = vi.hoisted(() => ({
  mockSetNativeAuthToken: vi.fn(),
}));

vi.mock('../services/tracking/backgroundLocation', () => ({
  setNativeAuthToken: mockSetNativeAuthToken,
}));

vi.mock('../services/api/client', () => ({
  default: {
    post: vi.fn(),
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
  disconnectSocket: vi.fn(),
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

describe('AuthContext — pont du token vers le worker natif (Phase 3)', () => {
  beforeEach(() => {
    mockSetNativeAuthToken.mockClear();
  });

  it('login() appelle setNativeAuthToken avec le token et son expiration (claim exp du JWT)', async () => {
    let loginFn: ReturnType<typeof useAuth>['login'] = () => {};
    render(
      <AuthProvider>
        <TestComponent onReady={(l) => { loginFn = l; }} />
      </AuthProvider>,
    );

    const expSeconds = Math.floor(Date.now() / 1000) + 900; // +15 min
    const token = makeJwt({
      sub: 'user-1',
      email: 'driver@test.com',
      role: 'driver',
      companyId: 'company-1',
      exp: expSeconds,
    });
    const user: User = {
      id: 'user-1',
      email: 'driver@test.com',
      firstName: 'Jean',
      lastName: 'Rakoto',
      role: 'driver',
      companyId: 'company-1',
    };

    await act(async () => {
      loginFn(user, token);
    });

    expect(mockSetNativeAuthToken).toHaveBeenCalledTimes(1);
    expect(mockSetNativeAuthToken).toHaveBeenCalledWith(token, expSeconds * 1000);
  });

  it("n'appelle PAS setNativeAuthToken si le token est malformé (pas de claim exp exploitable)", async () => {
    let loginFn: ReturnType<typeof useAuth>['login'] = () => {};
    render(
      <AuthProvider>
        <TestComponent onReady={(l) => { loginFn = l; }} />
      </AuthProvider>,
    );

    const user: User = {
      id: 'user-1',
      email: 'driver@test.com',
      firstName: 'Jean',
      lastName: 'Rakoto',
      role: 'driver',
      companyId: 'company-1',
    };

    await act(async () => {
      loginFn(user, 'not-a-valid-jwt');
    });

    expect(mockSetNativeAuthToken).not.toHaveBeenCalled();
  });
});
