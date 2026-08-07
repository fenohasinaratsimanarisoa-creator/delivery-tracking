import { StripeService, CheckoutResult } from './stripe.service';
import { ConfigService } from '@nestjs/config';

const mockStripeInstance = {
  checkout: {
    sessions: {
      create: jest.fn(),
    },
  },
  webhooks: {
    constructEvent: jest.fn(),
  },
  billingPortal: {
    sessions: {
      create: jest.fn(),
    },
  },
};

jest.mock('stripe', () => ({
  __esModule: true,
  default: jest.fn(() => mockStripeInstance),
  Stripe: jest.fn(() => mockStripeInstance),
}));

const mockConfigService = {
  get: jest.fn((key: string): string | undefined => {
    const config: Record<string, string> = {
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_WEBHOOK_SECRET: 'whsec_123',
      APP_URL: 'http://localhost:3000',
    };
    return config[key];
  }),
};

describe('StripeService', () => {
  let service: StripeService;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
      const config: Record<string, string> = {
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: 'whsec_123',
        APP_URL: 'http://localhost:3000',
      };
      return config[key];
    });
    service = new StripeService(mockConfigService as unknown as ConfigService);
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session with correct parameters', async () => {
      mockStripeInstance.checkout.sessions.create.mockResolvedValueOnce({
        id: 'cs_test_123',
        subscription: 'sub_123',
        url: 'https://checkout.stripe.com/pay/cs_test_123',
        client_secret: 'cs_test_secret',
      });

      const result: CheckoutResult = await service.createCheckoutSession(
        'plan-1',
        'comp-1',
        'company@test.com',
        'Test Company',
        'http://localhost:3000/success',
        'http://localhost:3000/cancel',
      );

      expect(mockStripeInstance.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: 'subscription',
          payment_method_types: ['card'],
          line_items: expect.arrayContaining([
            expect.objectContaining({
              price: 'plan-1',
              quantity: 1,
            }),
          ]),
          customer_email: 'company@test.com',
          metadata: { companyId: 'comp-1' },
          success_url: 'http://localhost:3000/success',
          cancel_url: 'http://localhost:3000/cancel',
        }),
      );

      expect(result).toEqual({
        provider: 'stripe',
        sessionUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        subscriptionId: 'sub_123',
        clientSecret: 'cs_test_secret',
      });
    });

    it('should return simulated session when Stripe is not configured', async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        if (key === 'APP_URL') return 'http://localhost:3000';
        return undefined;
      });

      const serviceWithoutStripe = new StripeService(mockConfigService as unknown as ConfigService);

      const result = await serviceWithoutStripe.createCheckoutSession(
        'plan-1',
        'comp-1',
        'company@test.com',
        'Test Company',
        'http://localhost:3000/success',
        'http://localhost:3000/cancel',
      );

      expect(result.provider).toBe('stripe');
      expect(result.sessionUrl).toContain('sim_sub_comp-1');
      expect(result.subscriptionId).toBe('sim_sub_comp-1');
    });

    it('should throw in production when Stripe is not configured (no silent simulation)', async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        return undefined;
      });

      const serviceProd = new StripeService(mockConfigService as unknown as ConfigService);

      await expect(
        serviceProd.createCheckoutSession(
          'plan-1',
          'comp-1',
          'company@test.com',
          'Test Company',
          'http://localhost:3000/success',
          'http://localhost:3000/cancel',
        ),
      ).rejects.toThrow('forbidden in production');
    });
  });

  describe('validateConfig', () => {
    it('throws in production when STRIPE_SECRET_KEY is missing and billing is enabled', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'BILLING_ENABLED') return 'true';
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        return undefined;
      });

      expect(() =>
        StripeService.validateConfig(mockConfigService as unknown as ConfigService),
      ).toThrow('STRIPE_SECRET_KEY is required in production');
    });

    it('does not throw in production when billing is disabled (pilot mode, no Stripe key)', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        return undefined;
      });

      expect(() =>
        StripeService.validateConfig(mockConfigService as unknown as ConfigService),
      ).not.toThrow();
    });

    it('does not throw outside production without STRIPE_SECRET_KEY', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'NODE_ENV') return 'development';
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        return undefined;
      });

      expect(() =>
        StripeService.validateConfig(mockConfigService as unknown as ConfigService),
      ).not.toThrow();
    });

    it('does not throw in production when STRIPE_SECRET_KEY is set', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'NODE_ENV') return 'production';
        if (key === 'BILLING_ENABLED') return 'true';
        if (key === 'STRIPE_SECRET_KEY') return 'sk_live_123';
        return undefined;
      });

      expect(() =>
        StripeService.validateConfig(mockConfigService as unknown as ConfigService),
      ).not.toThrow();
    });
  });

  describe('constructWebhookEvent', () => {
    it('should construct webhook event from payload and signature', () => {
      const event = { id: 'evt_123', type: 'checkout.session.completed' };
      mockStripeInstance.webhooks.constructEvent.mockReturnValueOnce(event);

      const result = service.constructWebhookEvent(Buffer.from('payload'), 'sig_header');

      expect(mockStripeInstance.webhooks.constructEvent).toHaveBeenCalledWith(
        Buffer.from('payload'),
        'sig_header',
        'whsec_123',
      );
      expect(result).toEqual(event);
    });

    it('should throw when Stripe is not configured', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        return undefined;
      });

      const serviceWithoutStripe = new StripeService(mockConfigService as unknown as ConfigService);

      expect(() =>
        serviceWithoutStripe.constructWebhookEvent(Buffer.from('payload'), 'sig'),
      ).toThrow('Stripe not configured');
    });

    it('should throw when webhook secret is not set', () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'STRIPE_SECRET_KEY') return 'sk_test_123';
        if (key === 'STRIPE_WEBHOOK_SECRET') return undefined;
        return undefined;
      });

      const serviceWithoutWebhookSecret = new StripeService(
        mockConfigService as unknown as ConfigService,
      );

      expect(() =>
        serviceWithoutWebhookSecret.constructWebhookEvent(Buffer.from('payload'), 'sig'),
      ).toThrow('STRIPE_WEBHOOK_SECRET not set');
    });
  });

  describe('handleWebhookEvent', () => {
    it('should handle checkout.session.completed event', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const event: any = {
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123' } },
      };

      await service.handleWebhookEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith('Checkout completed: cs_test_123');
    });

    it('should handle customer.subscription.updated event', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const event: any = {
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_123' } },
      };

      await service.handleWebhookEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith('Subscription updated: sub_123');
    });

    it('should handle invoice.paid event', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const event: any = {
        type: 'invoice.paid',
        data: { object: { id: 'inv_123' } },
      };

      await service.handleWebhookEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith('Invoice paid: inv_123');
    });

    it('should handle invoice.payment_failed event', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'warn');
      const event: any = {
        type: 'invoice.payment_failed',
        data: { object: { id: 'inv_456' } },
      };

      await service.handleWebhookEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith('Invoice payment failed: inv_456');
    });

    it('should log unhandled events', async () => {
      const loggerSpy = jest.spyOn(service['logger'], 'log');
      const event: any = { type: 'some.unknown.event', data: { object: {} } };

      await service.handleWebhookEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith('Unhandled Stripe event: some.unknown.event');
    });

    it('should return early when Stripe is not configured', async () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string): string | undefined => {
        if (key === 'STRIPE_SECRET_KEY') return undefined;
        return undefined;
      });

      const serviceWithoutStripe = new StripeService(mockConfigService as unknown as ConfigService);
      const loggerSpy = jest.spyOn(serviceWithoutStripe['logger'], 'warn');

      const event: any = { type: 'test', data: { object: {} } };
      await serviceWithoutStripe.handleWebhookEvent(event);

      expect(loggerSpy).toHaveBeenCalledWith('Stripe not configured — webhook event ignored');
    });
  });
});
