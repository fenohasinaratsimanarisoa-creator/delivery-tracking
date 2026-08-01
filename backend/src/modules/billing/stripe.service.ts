import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { BillingProvider } from '@prisma/client';

export interface CheckoutResult {
  provider: BillingProvider;
  sessionUrl?: string;
  subscriptionId?: string;
  clientSecret?: string;
}

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private stripe: Stripe | null = null;

  // Garde de production, appelée au démarrage (main.ts) à côté de
  // MobileMoneyService.validateSandbox() : interdit un checkout simulé silencieux
  // en production quand STRIPE_SECRET_KEY est absente. Le mode simulé ne reste
  // possible qu'en développement/test/CI.
  static validateConfig(configService: ConfigService): void {
    const secretKey = configService.get<string>('STRIPE_SECRET_KEY');
    const nodeEnv = configService.get<string>('NODE_ENV', 'development');
    if (!secretKey && nodeEnv === 'production') {
      throw new Error(
        'STRIPE_SECRET_KEY is required in production for Stripe payments. ' +
          'Configure it or set BILLING_ENABLED=false to disable billing.',
      );
    }
  }

  constructor(private configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (secretKey) {
      this.stripe = new Stripe(secretKey, { apiVersion: '2026-06-24.dahlia' });
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not set — Stripe payments disabled');
    }
  }

  async createCheckoutSession(
    planPriceId: string,
    companyId: string,
    companyEmail: string,
    companyName: string,
    successUrl: string,
    cancelUrl: string,
  ): Promise<CheckoutResult> {
    if (!this.stripe) {
      // Défense en profondeur : même si le garde de démarrage (validateConfig) était
      // contourné, on refuse de simuler un checkout en production.
      const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');
      if (nodeEnv === 'production') {
        throw new Error(
          'Stripe is not configured and simulated checkout is forbidden in production (STRIPE_SECRET_KEY missing).',
        );
      }
      this.logger.warn('Stripe not configured — simulating checkout session (non-production only)');
      return {
        provider: 'stripe' as BillingProvider,
        sessionUrl: `${this.configService.get('APP_URL', 'http://localhost:5173')}/billing/success?session_id=sim_sub_${companyId}`,
        subscriptionId: 'sim_sub_' + companyId,
      };
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: planPriceId, quantity: 1 }],
      customer_email: companyEmail,
      metadata: { companyId },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return {
      provider: 'stripe' as BillingProvider,
      sessionUrl: session.url || undefined,
      subscriptionId: session.subscription as string,
      clientSecret: session.client_secret || undefined,
    };
  }

  async handleWebhookEvent(event: Stripe.Event): Promise<void> {
    if (!this.stripe) {
      this.logger.warn('Stripe not configured — webhook event ignored');
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        this.logger.log(`Checkout completed: ${session.id}`);
        break;
      }
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        this.logger.log(`Subscription updated: ${subscription.id}`);
        break;
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;
        this.logger.log(`Invoice paid: ${invoice.id}`);
        break;
      }
      case 'invoice.payment_failed': {
        const failedInvoice = event.data.object as Stripe.Invoice;
        this.logger.warn(`Invoice payment failed: ${failedInvoice.id}`);
        break;
      }
      default:
        this.logger.log(`Unhandled Stripe event: ${event.type}`);
    }
  }

  constructWebhookEvent(payload: Buffer, signature: string): Stripe.Event {
    if (!this.stripe) {
      throw new Error('Stripe not configured');
    }
    const webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET not set');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }
}
