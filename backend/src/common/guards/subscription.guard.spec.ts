import { SubscriptionGuard } from './subscription.guard';
import { ManualPaymentRequiredException } from '../exceptions/manual-payment-required.exception';

describe('SubscriptionGuard', () => {
  let guard: SubscriptionGuard;
  const mockPrisma = {
    subscription: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const mockReflector = { getAllAndOverride: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockReflector.getAllAndOverride.mockReturnValue(false);
    guard = new SubscriptionGuard(mockPrisma as any, mockReflector as any);
  });

  const makeCtx = (user: any) =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as any;

  it('@SkipSubscriptionCheck() laisse toujours passer, même sans regarder request.user', async () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true);
    expect(mockPrisma.subscription.findUnique).not.toHaveBeenCalled();
  });

  it("laisse passer quand request.user est absent (l'auth tranchera plus loin)", async () => {
    await expect(guard.canActivate(makeCtx(undefined))).resolves.toBe(true);
  });

  it('laisse passer un admin plateforme (pas de companyId)', async () => {
    await expect(guard.canActivate(makeCtx({ type: 'platform_admin' }))).resolves.toBe(true);
  });

  it("bloque (402) si la société n'a AUCUNE ligne Subscription (échoue fermé, pas ouvert)", async () => {
    mockPrisma.subscription.findUnique.mockResolvedValue(null);
    await expect(guard.canActivate(makeCtx({ type: 'user', companyId: 'c1' }))).rejects.toThrow(
      ManualPaymentRequiredException,
    );
  });

  describe('essai (trialing)', () => {
    it("laisse passer pendant la fenêtre d'essai", async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'trialing',
        trialEndsAt: new Date(Date.now() + 60_000),
        currentPeriodEnd: new Date(Date.now() + 60_000),
      });
      await expect(guard.canActivate(makeCtx({ type: 'user', companyId: 'c1' }))).resolves.toBe(
        true,
      );
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('bloque et repasse le statut en past_due une fois trialEndsAt dépassé', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'trialing',
        trialEndsAt: new Date(Date.now() - 1000),
        currentPeriodEnd: new Date(Date.now() - 1000),
      });
      await expect(guard.canActivate(makeCtx({ type: 'user', companyId: 'c1' }))).rejects.toThrow(
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
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      });
      await expect(guard.canActivate(makeCtx({ type: 'user', companyId: 'c1' }))).resolves.toBe(
        true,
      );
    });

    it('bloque et repasse en past_due une fois la période dépassée', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() - 1000),
      });
      await expect(guard.canActivate(makeCtx({ type: 'user', companyId: 'c1' }))).rejects.toThrow(
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
      mockPrisma.subscription.findUnique.mockResolvedValue({
        id: 's1',
        status,
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      });
      await expect(guard.canActivate(makeCtx({ type: 'user', companyId: 'c1' }))).rejects.toThrow(
        ManualPaymentRequiredException,
      );
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });
});
