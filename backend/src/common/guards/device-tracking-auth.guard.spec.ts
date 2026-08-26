import { UnauthorizedException } from '@nestjs/common';
import { DeviceTrackingAuthGuard } from './device-tracking-auth.guard';

function ctx(headers: Record<string, string> = {}): any {
  const request: any = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    __request: request,
  };
}

const ACTIVE_USER = {
  id: 'user-1',
  email: 'driver@test.com',
  role: 'driver',
  companyId: 'company-1',
  isActive: true,
  firstName: 'Jean',
  lastName: 'Rakoto',
  company: { deletedAt: null },
};

describe('DeviceTrackingAuthGuard', () => {
  let guard: DeviceTrackingAuthGuard;
  let jwtService: any;
  let prisma: any;
  let redis: any;

  const baseIat = Math.floor(Date.now() / 1000);

  beforeEach(() => {
    jwtService = { verify: jest.fn() };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(ACTIVE_USER) },
      userSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'user-1',
          expiresAt: new Date(Date.now() + 86_400_000),
        }),
      },
    };
    redis = { get: jest.fn().mockResolvedValue(null) };
    guard = new DeviceTrackingAuthGuard(
      jwtService,
      { get: jest.fn().mockReturnValue('access-secret') } as any,
      prisma as any,
      redis as any,
    );
  });

  function payload(over: Record<string, unknown> = {}) {
    return {
      sub: 'user-1',
      email: 'driver@test.com',
      role: 'driver',
      companyId: 'company-1',
      firstName: 'Jean',
      lastName: 'Rakoto',
      iat: baseIat,
      ...over,
    };
  }

  it("accepte un DEVICE TOKEN (scope 'device_tracking') — le worker natif reste authentifié sans JS", async () => {
    jwtService.verify.mockReturnValue(
      payload({ scope: 'device_tracking', sessionId: 'session-1' }),
    );
    const c = ctx({ authorization: 'Bearer device-token' });

    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(c.__request.user).toEqual(
      expect.objectContaining({ id: 'user-1', role: 'driver', companyId: 'company-1' }),
    );
  });

  it("accepte un access token normal (scope absent) — compatibilité ascendante", async () => {
    jwtService.verify.mockReturnValue(payload());
    await expect(guard.canActivate(ctx({ authorization: 'Bearer access' }))).resolves.toBe(true);
  });

  it('rejette tout autre scope (2fa_pending, public-tracking…)', async () => {
    for (const scope of ['2fa_pending', 'public-tracking', 'whatever']) {
      jwtService.verify.mockReturnValue(payload({ scope }));
      await expect(guard.canActivate(ctx({ authorization: 'Bearer x' }))).rejects.toThrow(
        UnauthorizedException,
      );
    }
  });

  it('rejette un token de plateforme (admin) sur ce chemin chauffeur', async () => {
    jwtService.verify.mockReturnValue(payload({ type: 'platform_admin' }));
    await expect(guard.canActivate(ctx({ authorization: 'Bearer x' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejette sans en-tête Authorization', async () => {
    await expect(guard.canActivate(ctx())).rejects.toThrow(UnauthorizedException);
    expect(jwtService.verify).not.toHaveBeenCalled();
  });

  it('rejette un token invalide/expiré (verify lève)', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    await expect(guard.canActivate(ctx({ authorization: 'Bearer x' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("RÉVOCATION : un device token dont la session a été supprimée est refusé, malgré ses 30 j de validité nominale", async () => {
    jwtService.verify.mockReturnValue(
      payload({ scope: 'device_tracking', sessionId: 'session-1' }),
    );
    prisma.userSession.findUnique.mockResolvedValue(null); // logout / session révoquée

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('RÉVOCATION : session appartenant à un AUTRE utilisateur refusée', async () => {
    jwtService.verify.mockReturnValue(
      payload({ scope: 'device_tracking', sessionId: 'session-1' }),
    );
    prisma.userSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'autre-user',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('RÉVOCATION : session expirée refusée', async () => {
    jwtService.verify.mockReturnValue(
      payload({ scope: 'device_tracking', sessionId: 'session-1' }),
    );
    prisma.userSession.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('RÉVOCATION globale du compte (revoked:user) appliquée', async () => {
    jwtService.verify.mockReturnValue(payload({ scope: 'device_tracking' }));
    redis.get.mockImplementation((key: string) =>
      key.startsWith('revoked:user:') ? String(baseIat + 10) : null,
    );

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('RÉVOCATION ciblée de session (revoked:session) appliquée', async () => {
    jwtService.verify.mockReturnValue(
      payload({ scope: 'device_tracking', sessionId: 'session-1' }),
    );
    redis.get.mockImplementation((key: string) =>
      key.startsWith('revoked:session:') ? String(baseIat + 10) : null,
    );

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejette un utilisateur désactivé', async () => {
    jwtService.verify.mockReturnValue(payload({ scope: 'device_tracking' }));
    prisma.user.findUnique.mockResolvedValue({ ...ACTIVE_USER, isActive: false });

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejette si la société a été supprimée', async () => {
    jwtService.verify.mockReturnValue(payload({ scope: 'device_tracking' }));
    prisma.user.findUnique.mockResolvedValue({
      ...ACTIVE_USER,
      company: { deletedAt: new Date() },
    });

    await expect(guard.canActivate(ctx({ authorization: 'Bearer device' }))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
