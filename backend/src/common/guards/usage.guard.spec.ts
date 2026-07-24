import { UsageGuard } from './usage.guard';
import { ForbiddenException } from '@nestjs/common';

describe('UsageGuard', () => {
  let guard: UsageGuard;
  const mockPrisma = {
    subscription: {
      findUnique: jest.fn(),
    },
    billingPlan: {
      findUnique: jest.fn(),
    },
    delivery: {
      count: jest.fn(),
    },
    vehicle: {
      count: jest.fn(),
    },
    user: {
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const mockConfig = { get: jest.fn().mockReturnValue('true') };
    guard = new UsageGuard(mockPrisma as any, mockConfig as any);
  });

  const makeCtx = (override: any = {}) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          companyId: 'c1',
          user: { companyId: 'c1' },
          route: { path: override.path || '' },
          method: override.method || 'POST',
          ...override,
        }),
      }),
    }) as any;

  const makeCompanyResponse = (overrides: any = {}) => ({
    status: 'active',
    plan: {
      maxDeliveriesPerMonth: 50,
      maxVehicles: 5,
      maxUsers: 3,
      name: 'Starter',
      tier: 'starter',
      ...overrides,
    },
  });

  describe('quota strict — limite exacte', () => {
    const plan = {
      maxDeliveriesPerMonth: 10,
      maxVehicles: 2,
      maxUsers: 3,
      name: 'Starter',
      tier: 'starter',
    };

    it('10e livraison OK si quota=10, count=9', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(makeCompanyResponse(plan));
      mockPrisma.delivery.count.mockResolvedValue(9);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('10e livraison bloquée si quota=10, count=10', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(makeCompanyResponse(plan));
      mockPrisma.delivery.count.mockResolvedValue(10);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });

    it('11e livraison bloquée si quota=10, count=11', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(makeCompanyResponse(plan));
      mockPrisma.delivery.count.mockResolvedValue(11);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('plan enterprise — pas de limite', () => {
    it('delivery passe même avec 1000 sur plan sans limite', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(
        makeCompanyResponse({
          maxDeliveriesPerMonth: 999999,
          maxVehicles: 999999,
          maxUsers: 999999,
          name: 'Enterprise',
          tier: 'enterprise',
        }),
      );
      mockPrisma.delivery.count.mockResolvedValue(1000);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('quota à zéro', () => {
    it('bloque si maxVehicles = 0', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(makeCompanyResponse({ maxVehicles: 0 }));
      mockPrisma.vehicle.count.mockResolvedValue(0);
      const ctx = makeCtx({ path: '/vehicles', method: 'POST' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('sans abonnement — fallback plan free', () => {
    it('passe si le free plan existe et les compteurs sont dans les limites', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);
      mockPrisma.billingPlan.findUnique.mockResolvedValue({
        maxDeliveriesPerMonth: 20,
        maxVehicles: 2,
        maxUsers: 1,
        name: 'Gratuit',
        tier: 'free',
      });
      mockPrisma.delivery.count.mockResolvedValue(0);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('bloque si le compteur dépasse le plan free', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);
      mockPrisma.billingPlan.findUnique.mockResolvedValue({
        maxDeliveriesPerMonth: 20,
        maxVehicles: 2,
        maxUsers: 1,
        name: 'Gratuit',
        tier: 'free',
      });
      mockPrisma.delivery.count.mockResolvedValue(20);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('abonnement suspendu', () => {
    it('bloque si canceled', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'canceled', plan: {} });
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Votre abonnement est suspendu');
    });

    it('bloque si unpaid', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue({ status: 'unpaid', plan: {} });
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      await expect(guard.canActivate(ctx)).rejects.toThrow('Votre abonnement est suspendu');
    });
  });

  describe("message d'erreur contient quota et plan", () => {
    it('retourne le quota actuel et max dans le message', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(makeCompanyResponse());
      mockPrisma.delivery.count.mockResolvedValue(50);
      const ctx = makeCtx({ path: '/deliveries', method: 'POST' });
      try {
        await guard.canActivate(ctx);
        fail('should throw');
      } catch (e: any) {
        expect(e.message).toContain('50');
        expect(e.message).toContain('Starter');
      }
    });
  });

  describe('pas de companyId', () => {
    it('passe sans companyId', async () => {
      const ctx = makeCtx({ companyId: null });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
