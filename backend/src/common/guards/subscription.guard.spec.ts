import * as jwt from 'jsonwebtoken';
import { SubscriptionGuard } from './subscription.guard';
import { ManualPaymentRequiredException } from '../exceptions/manual-payment-required.exception';

jest.mock('jsonwebtoken');

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  const mockPrisma = {
    subscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockReflector = { getAllAndOverride: jest.fn() };
  const mockConfig = { get: jest.fn().mockReturnValue('access-secret') };

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.get.mockReturnValue('access-secret');
    mockReflector.getAllAndOverride.mockReturnValue(false);
    guard = new SubscriptionGuard(mockPrisma as any, mockReflector as any, mockConfig as any);
  });

  // Garde GLOBALE (APP_GUARD) : elle tourne AVANT JwtAuthGuard (pas globale
  // dans ce projet) — request.user n'existe donc jamais à ce stade. Elle doit
  // décoder le JWT elle-même depuis l'en-tête, jamais lire request.user.
  const makeCtx = (authHeader?: string) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: authHeader } }) }),
    }) as any;

  const BEARER = (payload: object) => {
    (jwt.verify as jest.Mock).mockReturnValue(payload);
    return 'Bearer valid-token';
  };

  it('@SkipSubscriptionCheck() laisse toujours passer, même sans en-tête Authorization', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true);
    expect(mockPrisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("laisse passer sans en-tête Authorization (l'auth tranchera plus loin)", async () => {
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true);
  });

  it('laisse passer un JWT invalide/expiré (jamais son rôle de rejeter — JwtAuthGuard le fera)', async () => {
    (jwt.verify as jest.Mock).mockImplementation(() => {
      throw new Error('invalid signature');
    });
    await expect(guard.canActivate(makeCtx('Bearer garbage'))).resolves.toBe(true);
  });

  it('laisse passer un admin plateforme (pas de companyId)', async () => {
    const header = BEARER({ type: 'platform_admin' });
    await expect(guard.canActivate(makeCtx(header))).resolves.toBe(true);
    expect(mockPrisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("bloque (402) si la société n'a AUCUNE ligne Subscription (échoue fermé, pas ouvert)", async () => {
    const header = BEARER({ type: 'user', companyId: 'c1' });
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(makeCtx(header))).rejects.toThrow(
      ManualPaymentRequiredException,
    );
  });

  describe('essai (trialing)', () => {
    it("laisse passer pendant la fenêtre d'essai", async () => {
      const header = BEARER({ type: 'user', companyId: 'c1' });
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + 60_000),
        currentPeriodEnd: new Date(Date.now() + 60_000),
      });
      await expect(guard.canActivate(makeCtx(header))).resolves.toBe(true);
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('bloque et repasse le statut en past_due une fois trialEndsAt dépassé', async () => {
      const header = BEARER({ type: 'user', companyId: 'c1' });
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'trialing',
        trialEndsAt: new Date(Date.now() - 1000),
        currentPeriodEnd: new Date(Date.now() - 1000),
      });
      await expect(guard.canActivate(makeCtx(header))).rejects.toThrow(
        ManualPaymentRequiredException,
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'past_due' },
      });
    });
  });

  describe('actif (active)', () => {
    it("laisse passer tant que currentPeriodEnd n'est pas dépassé", async () => {
      const header = BEARER({ type: 'user', companyId: 'c1' });
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      });
      await expect(guard.canActivate(makeCtx(header))).resolves.toBe(true);
    });

    it('bloque et repasse en past_due une fois la période dépassée', async () => {
      const header = BEARER({ type: 'user', companyId: 'c1' });
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() - 1000),
      });
      await expect(guard.canActivate(makeCtx(header))).rejects.toThrow(
        ManualPaymentRequiredException,
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'past_due' },
      });
    });
  });

  describe.each(['past_due', 'unpaid', 'canceled', 'incomplete'])('statut %s', (status) => {
    it('bloque toujours, sans tenter de repasser le statut', async () => {
      const header = BEARER({ type: 'user', companyId: 'c1' });
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status,
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      });
      await expect(guard.canActivate(makeCtx(header))).rejects.toThrow(
        ManualPaymentRequiredException,
      );
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });
});
