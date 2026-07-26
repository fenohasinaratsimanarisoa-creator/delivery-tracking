import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StripeService } from './stripe.service';
import { MobileMoneyService } from './mobile-money.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { EmailService } from '../email/email.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { BillingProvider, SubscriptionStatus } from '@prisma/client';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { ConfigService } from '@nestjs/config';

const mockPrisma = {
  billingPlan: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  subscription: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
  invoice: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    groupBy: jest.fn(),
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

const mockStripeService = {
  createCheckoutSession: jest.fn(),
  constructWebhookEvent: jest.fn(),
};

const mockMobileMoneyService = {
  requestPayment: jest.fn(),
};

const mockInvoicePdfService = {
  generateInvoice: jest.fn(),
};

const mockEmailService = {
  send: jest.fn(),
  sendDigest: jest.fn(),
  sendBillingActivated: jest.fn(),
  sendBillingPaymentFailed: jest.fn(),
  sendBillingExpired: jest.fn(),
  sendBillingSuspended: jest.fn(),
};

const mockRedis = {
  get: jest.fn(),
  set: jest.fn(),
};

describe('BillingService', () => {
  let service: BillingService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StripeService, useValue: mockStripeService },
        { provide: MobileMoneyService, useValue: mockMobileMoneyService },
        { provide: InvoicePdfService, useValue: mockInvoicePdfService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('true') } },
      ],
    }).compile();

    service = module.get<BillingService>(BillingService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getPlans', () => {
    it('should return active plans ordered by price', async () => {
      const plans = [
        { id: 'plan-1', tier: 'free', name: 'Free', price: 0 },
        { id: 'plan-2', tier: 'starter', name: 'Starter', price: 2900 },
      ];
      mockPrisma.billingPlan.findMany.mockResolvedValueOnce(plans);

      const result = await service.getPlans();

      expect(mockPrisma.billingPlan.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { price: 'asc' },
      });
      expect(result).toEqual(plans);
    });
  });

  describe('createPlan', () => {
    it('should create a new billing plan', async () => {
      const dto: CreatePlanDto = {
        tier: 'pro',
        name: 'Pro Plan',
        description: 'Professional plan',
        price: 9900,
        currency: 'EUR',
        interval: 'month',
        maxVehicles: 20,
        maxDeliveriesPerMonth: 500,
        maxUsers: 10,
        features: ['feature1', 'feature2'],
      };

      const createdPlan = { id: 'plan-new', ...dto };
      mockPrisma.billingPlan.create.mockResolvedValueOnce(createdPlan);

      const result = await service.createPlan(dto);

      expect(mockPrisma.billingPlan.create).toHaveBeenCalledWith({
        data: {
          tier: 'pro',
          name: 'Pro Plan',
          description: 'Professional plan',
          price: 9900,
          currency: 'EUR',
          interval: 'month',
          maxVehicles: 20,
          maxDeliveriesPerMonth: 500,
          maxUsers: 10,
          features: ['feature1', 'feature2'],
        },
      });
      expect(result).toEqual(createdPlan);
    });
  });

  describe('updatePlan', () => {
    it('should update plan fields', async () => {
      const existingPlan = { id: 'plan-1', name: 'Old Name', price: 1000 };
      mockPrisma.billingPlan.findUnique.mockResolvedValueOnce(existingPlan);
      mockPrisma.billingPlan.update.mockResolvedValueOnce({ ...existingPlan, name: 'New Name' });

      const result = await service.updatePlan('plan-1', { name: 'New Name', price: 2000 });

      expect(mockPrisma.billingPlan.update).toHaveBeenCalledWith({
        where: { id: 'plan-1' },
        data: { name: 'New Name', price: 2000 },
      });
      expect(result.name).toBe('New Name');
    });

    it('should throw NotFoundException when plan does not exist', async () => {
      mockPrisma.billingPlan.findUnique.mockResolvedValueOnce(null);

      await expect(service.updatePlan('plan-1', { name: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCompanySubscription', () => {
    it('should return subscription with plan and invoices', async () => {
      const subscription = {
        id: 'sub-1',
        companyId: 'comp-1',
        plan: { id: 'plan-1', name: 'Pro' },
        invoices: [{ id: 'inv-1' }],
      };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(subscription);

      const result = await service.getCompanySubscription('comp-1');

      expect(mockPrisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { companyId: 'comp-1' },
        include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 5 } },
      });
      expect(result).toEqual(subscription);
    });
  });

  describe('createOrUpdateSubscription', () => {
    const company = { id: 'comp-1', email: 'comp@test.com', name: 'Test Company' };
    const plan = { id: 'plan-1', name: 'Pro', price: 9900, currency: 'EUR', interval: 'month' };

    beforeEach(() => {
      mockPrisma.company.findUnique.mockResolvedValue(company);
      mockPrisma.billingPlan.findUnique.mockResolvedValue(plan);
    });

    it('should create Stripe checkout session', async () => {
      const checkoutSession = {
        sessionId: 'cs_test_123',
        subscriptionId: 'sub_stripe_123',
        url: 'https://checkout.stripe.com/...',
      };
      mockStripeService.createCheckoutSession.mockResolvedValueOnce(checkoutSession);
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);

      const dto: CreateCheckoutDto = { planId: 'plan-1', provider: 'stripe' };
      const result = await service.createOrUpdateSubscription('comp-1', dto);

      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith(
        'plan-1',
        'comp-1',
        'comp@test.com',
        'Test Company',
        expect.stringContaining('/billing/success'),
        expect.stringContaining('/billing'),
      );
      expect(result).toEqual(checkoutSession);
    });

    it('should throw BadRequestException when already subscribed to same plan', async () => {
      const existingSub = { id: 'sub-1', planId: 'plan-1', status: 'active' };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(existingSub);

      const dto: CreateCheckoutDto = { planId: 'plan-1', provider: 'stripe' };

      await expect(service.createOrUpdateSubscription('comp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create mobile money payment for Mvola', async () => {
      const payment = { transactionRef: 'mvola_ref_123', providerMessage: 'Payment initiated' };
      mockMobileMoneyService.requestPayment.mockResolvedValueOnce(payment);
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);

      const dto: CreateCheckoutDto = {
        planId: 'plan-1',
        provider: 'mvola',
        mobileMoneyPhone: '+261341234567',
      };
      const result = (await service.createOrUpdateSubscription('comp-1', dto)) as {
        provider: string;
        transactionRef: string;
        message: string;
      };

      expect(mockMobileMoneyService.requestPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 9900,
          currency: 'EUR',
          phone: '+261341234567',
          companyId: 'comp-1',
        }),
        'mvola',
      );
      expect(result).toEqual({
        provider: 'mvola',
        transactionRef: 'mvola_ref_123',
        message: 'Payment initiated',
      });
    });

    it('should throw BadRequestException when mobile money phone missing', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);

      const dto: CreateCheckoutDto = { planId: 'plan-1', provider: 'mvola' };

      await expect(service.createOrUpdateSubscription('comp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException for invalid provider', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);

      const dto: CreateCheckoutDto = { planId: 'plan-1', provider: 'invalid' as any };

      await expect(service.createOrUpdateSubscription('comp-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when company not found', async () => {
      mockPrisma.company.findUnique.mockResolvedValueOnce(null);

      const dto: CreateCheckoutDto = { planId: 'plan-1', provider: 'stripe' };

      await expect(service.createOrUpdateSubscription('comp-1', dto)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription', async () => {
      const sub = { id: 'sub-1', companyId: 'comp-1' };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({
        ...sub,
        status: 'canceled',
        canceledAt: new Date(),
      });

      const result = await service.cancelSubscription('comp-1');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'canceled', canceledAt: expect.any(Date) },
      });
      expect(result.status).toBe('canceled');
    });

    it('should throw NotFoundException when no subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);

      await expect(service.cancelSubscription('comp-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getInvoice', () => {
    it('should return invoice with relations', async () => {
      const invoice = {
        id: 'inv-1',
        companyId: 'comp-1',
        company: { id: 'comp-1' },
        subscription: { id: 'sub-1', plan: { name: 'Pro' } },
      };
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(invoice);

      const result = await service.getInvoice('inv-1', 'comp-1');

      expect(result).toEqual(invoice);
    });

    it('should throw NotFoundException when invoice not found', async () => {
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(null);

      await expect(service.getInvoice('inv-1', 'comp-1')).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when invoice belongs to different company', async () => {
      const invoice = { id: 'inv-1', companyId: 'other-comp' };
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(invoice);

      await expect(service.getInvoice('inv-1', 'comp-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('downloadInvoicePdf', () => {
    it('should generate PDF for invoice', async () => {
      const invoice = { id: 'inv-1', companyId: 'comp-1' };
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(invoice);
      mockInvoicePdfService.generateInvoice.mockResolvedValueOnce(Buffer.from('pdf-content'));

      const result = await service.downloadInvoicePdf('inv-1', 'comp-1');

      expect(result).toEqual(Buffer.from('pdf-content'));
    });
  });

  describe('getCompanyInvoices', () => {
    it('should return paginated invoices', async () => {
      const invoices = [{ id: 'inv-1', subscription: { plan: { name: 'Pro' } } }];
      mockPrisma.invoice.findMany.mockResolvedValueOnce(invoices);
      mockPrisma.invoice.count.mockResolvedValueOnce(1);

      const result = await service.getCompanyInvoices('comp-1', 1, 20);

      expect(result.data).toEqual(invoices);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('getCompanyUsage', () => {
    it('should return usage stats with plan limits', async () => {
      const sub = {
        plan: {
          maxDeliveriesPerMonth: 500,
          maxVehicles: 20,
          maxUsers: 10,
          name: 'Pro',
          tier: 'pro',
        },
      };
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(sub);
      mockPrisma.delivery.count.mockResolvedValueOnce(150);
      mockPrisma.vehicle.count.mockResolvedValueOnce(8);
      mockPrisma.user.count.mockResolvedValueOnce(5);

      const result = await service.getCompanyUsage('comp-1');

      expect(result.deliveriesUsed).toBe(150);
      expect(result.deliveriesLimit).toBe(500);
      expect(result.vehiclesUsed).toBe(8);
      expect(result.vehiclesLimit).toBe(20);
      expect(result.usersUsed).toBe(5);
      expect(result.usersLimit).toBe(10);
    });

    it('should use free plan limits when no subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValueOnce(null);
      mockPrisma.billingPlan.findUnique.mockResolvedValueOnce({
        tier: 'free',
        maxDeliveriesPerMonth: 50,
        maxVehicles: 5,
        maxUsers: 3,
        name: 'Free',
      });
      mockPrisma.delivery.count.mockResolvedValueOnce(10);
      mockPrisma.vehicle.count.mockResolvedValueOnce(2);
      mockPrisma.user.count.mockResolvedValueOnce(2);

      const result = await service.getCompanyUsage('comp-1');

      expect(result.deliveriesLimit).toBe(50);
      expect(result.vehiclesLimit).toBe(5);
      expect(result.usersLimit).toBe(3);
    });
  });

  describe('confirmMobileMoney', () => {
    it('should activate subscription and create invoice on confirmation', async () => {
      const sub = {
        id: 'sub-1',
        companyId: 'comp-1',
        status: 'incomplete',
        plan: { id: 'plan-1', price: 9900, currency: 'EUR', interval: 'month' },
        company: { id: 'comp-1', users: [{ email: 'admin@comp.com', firstName: 'Admin' }] },
      };
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'active' });
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invoice.count.mockResolvedValueOnce(5);
      mockPrisma.invoice.create.mockResolvedValueOnce({ id: 'inv-1' });

      await service.confirmMobileMoney('mvola_ref_123');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          status: 'active',
          currentPeriodStart: expect.any(Date),
          currentPeriodEnd: expect.any(Date),
        },
      });
      expect(mockPrisma.invoice.create).toHaveBeenCalled();
    });

    it('should not create duplicate invoice', async () => {
      const sub = {
        id: 'sub-1',
        companyId: 'comp-1',
        status: 'incomplete',
        plan: { id: 'plan-1', price: 9900, currency: 'EUR', interval: 'month' },
        company: { id: 'comp-1' },
      };
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({ ...sub, status: 'active' });
      mockPrisma.invoice.findUnique.mockResolvedValueOnce({ id: 'existing-inv' });

      await service.confirmMobileMoney('mvola_ref_123');

      expect(mockPrisma.invoice.create).not.toHaveBeenCalled();
    });

    it('should skip if subscription already active', async () => {
      const sub = { id: 'sub-1', status: 'active' };
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);
      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.confirmMobileMoney('mvola_ref_123');

      expect(loggerSpy).toHaveBeenCalledWith(
        'Mobile money ref mvola_ref_123 already confirmed — skipping',
      );
    });
  });

  describe('handleStripeWebhook', () => {
    it('should skip already processed events', async () => {
      const event = { id: 'evt_123', type: 'checkout.session.completed', data: { object: {} } };
      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockRedis.get.mockResolvedValueOnce('1');

      const loggerSpy = jest.spyOn(service['logger'], 'log');

      await service.handleStripeWebhook(Buffer.from(''), 'sig');

      expect(mockStripeService.constructWebhookEvent).toHaveBeenCalled();
      expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('already processed'));
    });

    it('should handle checkout.session.completed', async () => {
      const event = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: {
          object: {
            metadata: { companyId: 'comp-1' },
            subscription: 'sub_stripe_123',
            customer: 'cus_123',
          },
        },
      };
      const sub = {
        id: 'sub-1',
        planId: 'plan-1',
        plan: { name: 'Pro' },
        company: { users: [{ email: 'admin@comp.com', firstName: 'Admin' }] },
      };
      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockResolvedValueOnce('OK');
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({});
      mockPrisma.billingPlan.findUnique.mockResolvedValueOnce({
        id: 'plan-1',
        price: 9900,
        currency: 'EUR',
      });
      mockPrisma.invoice.findUnique.mockResolvedValueOnce(null);
      mockPrisma.invoice.count.mockResolvedValueOnce(0);
      mockPrisma.invoice.create.mockResolvedValueOnce({});

      await service.handleStripeWebhook(Buffer.from(''), 'sig');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: {
          status: 'active',
          stripeCustomerId: 'cus_123',
          currentPeriodStart: expect.any(Date),
          currentPeriodEnd: expect.any(Date),
        },
      });
    });

    it('should handle invoice.payment_failed', async () => {
      const event = {
        id: 'evt_456',
        type: 'invoice.payment_failed',
        data: { object: { subscription: 'sub_stripe_123' } },
      };
      const sub = {
        id: 'sub-1',
        company: { users: [{ email: 'admin@comp.com', firstName: 'Admin' }] },
      };
      mockStripeService.constructWebhookEvent.mockReturnValueOnce(event);
      mockRedis.get.mockResolvedValueOnce(null);
      mockRedis.set.mockResolvedValueOnce('OK');
      mockPrisma.subscription.findFirst.mockResolvedValueOnce(sub);
      mockPrisma.subscription.update.mockResolvedValueOnce({});

      await service.handleStripeWebhook(Buffer.from(''), 'sig');

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'past_due' },
      });
    });
  });

  describe('handleExpiredSubscriptions (cron)', () => {
    it('should mark expired subscriptions as past_due and notify admins', async () => {
      const now = new Date();
      jest.useFakeTimers();
      jest.setSystemTime(now);

      const expiredSub = {
        id: 'sub-1',
        companyId: 'comp-1',
        currentPeriodEnd: new Date(now.getTime() - 86400000),
        company: { users: [{ email: 'admin@comp.com', firstName: 'Admin' }] },
      };
      mockPrisma.subscription.findMany.mockResolvedValueOnce([expiredSub]);
      mockPrisma.subscription.update.mockResolvedValueOnce({});

      await service.handleExpiredSubscriptions();

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'past_due' },
      });
      expect(mockEmailService.sendBillingExpired).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('handleUnpaidSubscriptions (cron)', () => {
    it('should mark old past_due subscriptions as unpaid', async () => {
      const now = new Date();
      jest.useFakeTimers();
      jest.setSystemTime(now);

      const unpaidSub = {
        id: 'sub-1',
        company: { users: [{ email: 'admin@comp.com', firstName: 'Admin' }] },
      };
      mockPrisma.subscription.findMany.mockResolvedValueOnce([unpaidSub]);
      mockPrisma.subscription.update.mockResolvedValueOnce({});

      await service.handleUnpaidSubscriptions();

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'unpaid' },
      });

      jest.useRealTimers();
    });
  });
});
