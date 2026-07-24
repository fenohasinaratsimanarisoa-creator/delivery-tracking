import * as crypto from 'crypto';
import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { StripeService } from './stripe.service';
import { MobileMoneyService } from './mobile-money.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { EmailService } from '../email/email.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { BillingProvider, InvoiceStatus, SubscriptionStatus } from '@prisma/client';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { t, formatLongDate, type Language } from '../../common/i18n';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private mobileMoneyService: MobileMoneyService,
    private invoicePdfService: InvoicePdfService,
    private emailService: EmailService,
    private configService: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  async getPlans() {
    return this.prisma.billingPlan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });
  }

  async createPlan(dto: CreatePlanDto) {
    const features = dto.features || [];
    return this.prisma.billingPlan.create({
      data: {
        tier: dto.tier as any,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        currency: dto.currency || 'EUR',
        interval: dto.interval || 'month',
        maxVehicles: dto.maxVehicles,
        maxDeliveriesPerMonth: dto.maxDeliveriesPerMonth,
        maxUsers: dto.maxUsers,
        features: features,
      },
    });
  }

  async updatePlan(id: string, dto: Partial<CreatePlanDto>) {
    const plan = await this.prisma.billingPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return this.prisma.billingPlan.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.price !== undefined && { price: dto.price }),
        ...(dto.maxVehicles !== undefined && { maxVehicles: dto.maxVehicles }),
        ...(dto.maxDeliveriesPerMonth !== undefined && {
          maxDeliveriesPerMonth: dto.maxDeliveriesPerMonth,
        }),
        ...(dto.maxUsers !== undefined && { maxUsers: dto.maxUsers }),
        ...(dto.features && { features: dto.features }),
      },
    });
  }

  async getCompanySubscription(companyId: string) {
    return this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 5 } },
    });
  }

  async createOrUpdateSubscription(companyId: string, dto: CreateCheckoutDto, lang: Language = 'fr') {
    const plan = await this.prisma.billingPlan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plan not found');

    const existing = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (existing && existing.status === 'active' && existing.planId === dto.planId) {
      throw new BadRequestException('Company already has an active subscription on this plan');
    }

    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Company not found');

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + (plan.interval === 'year' ? 12 : 1));

    if (dto.provider === 'stripe') {
      const checkout = await this.stripeService.createCheckoutSession(
        plan.id,
        companyId,
        company.email || '',
        company.name,
        `${process.env.APP_URL || 'http://localhost:5173'}/billing/success`,
        `${process.env.APP_URL || 'http://localhost:5173'}/billing`,
      );

      if (existing) {
        await this.prisma.subscription.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            provider: 'stripe',
            stripeSubscriptionId: checkout.subscriptionId,
            status: 'incomplete',
            currentPeriodEnd: periodEnd,
          },
        });
      } else {
        await this.prisma.subscription.create({
          data: {
            companyId,
            planId: plan.id,
            provider: 'stripe',
            stripeSubscriptionId: checkout.subscriptionId,
            status: 'incomplete',
            currentPeriodEnd: periodEnd,
          },
        });
      }

      return checkout;
    }

    if (dto.provider === 'mvola' || dto.provider === 'orange_money') {
      if (!dto.mobileMoneyPhone) {
        throw new BadRequestException('Phone number required for mobile money');
      }

      const intervalLabel = plan.interval === 'year'
        ? t('invoice.planYearly', lang)
        : t('invoice.planMonthly', lang);
      const payment = await this.mobileMoneyService.requestPayment(
        {
          amount: plan.price,
          currency: plan.currency,
          phone: dto.mobileMoneyPhone,
          companyId,
          description: t('billing.paymentDescription', lang, { planName: plan.name, interval: intervalLabel }),
        },
        dto.provider,
      );

      if (existing) {
        await this.prisma.subscription.update({
          where: { id: existing.id },
          data: {
            planId: plan.id,
            provider: dto.provider,
            mobileMoneyRef: payment.transactionRef,
            status: 'incomplete',
            currentPeriodEnd: periodEnd,
          },
        });
      } else {
        await this.prisma.subscription.create({
          data: {
            companyId,
            planId: plan.id,
            provider: dto.provider,
            mobileMoneyRef: payment.transactionRef,
            status: 'incomplete',
            currentPeriodEnd: periodEnd,
          },
        });
      }

      return {
        provider: dto.provider,
        transactionRef: payment.transactionRef,
        message: payment.providerMessage,
      };
    }

    throw new BadRequestException('Invalid payment provider');
  }

  async cancelSubscription(companyId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { companyId } });
    if (!sub) throw new NotFoundException('No active subscription');

    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'canceled', canceledAt: new Date() },
    });
  }

  async getInvoice(invoiceId: string, companyId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { company: true, subscription: { include: { plan: true } } },
    });
    if (!invoice || invoice.companyId !== companyId) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async downloadInvoicePdf(invoiceId: string, companyId: string, lang: Language = 'fr'): Promise<Buffer> {
    const invoice = await this.getInvoice(invoiceId, companyId);
    return this.invoicePdfService.generateInvoice(invoice.id, lang);
  }

  async getCompanyInvoices(companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { subscription: { include: { plan: true } } },
      }),
      this.prisma.invoice.count({ where: { companyId } }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async getCompanyUsage(companyId: string, lang: Language = 'fr') {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [deliveriesThisMonth, vehicles, users] = await Promise.all([
      this.prisma.delivery.count({
        where: { companyId, deletedAt: null, createdAt: { gte: startOfMonth } },
      }),
      this.prisma.vehicle.count({ where: { companyId, deletedAt: null } }),
      this.prisma.user.count({ where: { companyId, deletedAt: null, isActive: true } }),
    ]);

    const sub = await this.prisma.subscription.findUnique({
      where: { companyId },
      include: { plan: true },
    });

    let plan = sub?.plan;
    if (!plan) {
      plan = (await this.prisma.billingPlan.findUnique({ where: { tier: 'free' } })) || undefined;
    }

    return {
      deliveriesUsed: deliveriesThisMonth,
      deliveriesLimit: plan?.maxDeliveriesPerMonth ?? 0,
      vehiclesUsed: vehicles,
      vehiclesLimit: plan?.maxVehicles ?? 0,
      usersUsed: users,
      usersLimit: plan?.maxUsers ?? 0,
      plan: plan ? { name: plan.name, tier: plan.tier } : { name: t('billing.planNameNone', lang), tier: 'free' },
    };
  }

  async verifyMobileMoneySignature(rawBody: Buffer, signature: string | undefined, _provider: string): Promise<void> {
    const isSandbox = this.configService.get<string>('MOBILE_MONEY_SANDBOX', 'true') === 'true';
    const nodeEnv = this.configService.get<string>('NODE_ENV', 'development');

    if (isSandbox && nodeEnv === 'production') {
      throw new BadRequestException(
        'Mobile money sandbox mode is forbidden in production. Set MOBILE_MONEY_SANDBOX=false and configure real API keys.',
      );
    }

    if (isSandbox) {
      this.logger.warn('Mobile money sandbox — webhook signature verification skipped');
      return;
    }

    if (!signature) {
      throw new BadRequestException('Missing x-mm-signature header — webhook rejected');
    }

    const secret = this.configService.get<string>('MOBILE_MONEY_WEBHOOK_SECRET');
    if (!secret) {
      throw new BadRequestException(
        'MOBILE_MONEY_WEBHOOK_SECRET not configured — cannot verify webhook authenticity',
      );
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const actual = signature;

    if (expected.length !== actual.length) {
      throw new BadRequestException('Invalid mobile money webhook signature');
    }

    if (!crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
      throw new BadRequestException('Invalid mobile money webhook signature');
    }

    this.logger.log('Mobile money webhook signature verified');
  }

  async confirmMobileMoney(transactionRef: string) {
    const sub = await this.prisma.subscription.findFirst({
      where: { mobileMoneyRef: transactionRef },
      include: { plan: true, company: true },
    });

    if (!sub) {
      this.logger.warn(`No subscription found for mobile money ref: ${transactionRef}`);
      return;
    }

    if (sub.status === 'active') {
      this.logger.log(`Mobile money ref ${transactionRef} already confirmed — skipping`);
      return;
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + (sub.plan.interval === 'year' ? 12 : 1));

    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd },
    });

    await this.createInvoice(
      sub.id,
      sub.companyId,
      sub.plan.price,
      sub.plan.currency,
      sub.provider as BillingProvider,
      transactionRef,
    );
    this.logger.log(`Mobile money payment confirmed for company ${sub.companyId}`);
  }

  async handleStripeWebhook(payload: Buffer, signature: string): Promise<void> {
    const event = this.stripeService.constructWebhookEvent(payload, signature);
    const eventId = event.id;
    const eventType = event.type;

    this.logger.log(`Processing Stripe event: ${eventType} (${eventId})`);

    if (this.redis) {
      const alreadyProcessed = await this.redis.get(`stripe:event:${eventId}`);
      if (alreadyProcessed) {
        this.logger.log(`Event ${eventId} already processed — skipping`);
        return;
      }
      await this.redis.set(`stripe:event:${eventId}`, '1', 'EX', 86400);
    }

    switch (eventType) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const companyId = session.metadata?.companyId;
        const subscriptionId = session.subscription as string;

        if (!companyId || !subscriptionId) {
          this.logger.warn(`Missing companyId or subscriptionId in checkout.session.completed`);
          break;
        }

        const sub = await this.prisma.subscription.findFirst({
          where: { stripeSubscriptionId: subscriptionId },
          include: {
            plan: true,
            company: { include: { users: { where: { role: 'admin', isActive: true } } } },
          },
        });

        if (!sub) {
          this.logger.warn(`No subscription found for stripe_sub: ${subscriptionId}`);
          break;
        }

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            stripeCustomerId: session.customer as string,
          },
        });

        const plan = await this.prisma.billingPlan.findUnique({ where: { id: sub.planId } });
        if (plan) {
          await this.createInvoice(
            sub.id,
            sub.companyId,
            plan.price,
            plan.currency,
            'stripe',
            subscriptionId,
          );
        }

        for (const admin of sub.company.users) {
          const lang = (admin as any).lang || 'fr';
          await this.emailService.sendBillingActivated(
            admin.email,
            admin.firstName,
            sub.plan?.name || plan?.name || '',
            lang,
          );
        }

        this.logger.log(`Subscription ${sub.id} activated (checkout completed)`);
        break;
      }

      case 'invoice.paid': {
        const invoiceObj = event.data.object as any;
        const stripeSubId = invoiceObj.subscription as string;

        if (!stripeSubId) break;

        const sub = await this.prisma.subscription.findFirst({
          where: { stripeSubscriptionId: stripeSubId },
          include: { plan: true },
        });

        if (!sub || !sub.plan) break;

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + (sub.plan.interval === 'year' ? 12 : 1));

        await this.prisma.subscription.update({
          where: { id: sub.id },
          data: {
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
          },
        });

        await this.createInvoice(
          sub.id,
          sub.companyId,
          sub.plan.price,
          sub.plan.currency,
          'stripe',
          invoiceObj.id,
        );

        this.logger.log(`Invoice paid for subscription ${sub.id}`);
        break;
      }

      case 'invoice.payment_failed': {
        const failedInvoice = event.data.object as any;
        const failedStripeSubId = failedInvoice.subscription as string;

        if (!failedStripeSubId) break;

        const sub = await this.prisma.subscription.findFirst({
          where: { stripeSubscriptionId: failedStripeSubId },
          include: {
            company: { include: { users: { where: { role: 'admin', isActive: true } } } },
          },
        });

        if (sub) {
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'past_due' },
          });

          for (const admin of sub.company.users) {
            const lang = (admin as any).lang || 'fr';
            await this.emailService.sendBillingPaymentFailed(
              admin.email,
              admin.firstName,
              lang,
            );
          }
        }

        this.logger.warn(`Payment failed for subscription ${failedStripeSubId} — marked past_due`);
        break;
      }

      case 'customer.subscription.deleted': {
        const deletedSub = event.data.object as any;
        const deletedStripeSubId = deletedSub.id as string;

        if (!deletedStripeSubId) break;

        const sub = await this.prisma.subscription.findFirst({
          where: { stripeSubscriptionId: deletedStripeSubId },
          include: {
            company: { include: { users: { where: { role: 'admin', isActive: true } } } },
          },
        });

        if (sub) {
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'canceled', canceledAt: new Date() },
          });

          for (const admin of sub.company.users) {
            const lang = (admin as any).lang || 'fr';
            await this.emailService.sendBillingCanceled(
              admin.email,
              admin.firstName,
              lang,
            );
          }
        }

        this.logger.log(`Subscription ${deletedStripeSubId} canceled via Stripe`);
        break;
      }

      default:
        this.logger.log(`Unhandled Stripe event type: ${eventType}`);
    }
  }

  private async createInvoice(
    subscriptionId: string,
    companyId: string,
    amount: number,
    currency: string,
    provider: BillingProvider,
    providerInvoiceId?: string,
  ) {
    if (providerInvoiceId) {
      const existing = await this.prisma.invoice.findUnique({
        where: { providerInvoiceId },
      });
      if (existing) {
        this.logger.log(`Invoice already exists for providerInvoiceId: ${providerInvoiceId}`);
        return existing;
      }
    }

    const count = await this.prisma.invoice.count();
    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(count + 1).padStart(5, '0')}`;

    const invoice = await this.prisma.invoice.create({
      data: {
        companyId,
        subscriptionId,
        invoiceNumber,
        amount,
        currency,
        status: 'paid',
        provider,
        providerInvoiceId,
        paidAt: new Date(),
      },
    });

    return invoice;
  }

  @Cron('0 3 * * *')
  async handleExpiredSubscriptions() {
    if (this.configService.get<string>('BILLING_ENABLED') !== 'true') { this.logger.log('BILLING_ENABLED=false — skipping expired subscription check'); return; }
    this.logger.log('Running subscription expiry check...');

    const expired = await this.prisma.subscription.findMany({
      where: {
        status: 'active',
        currentPeriodEnd: { lt: new Date() },
      },
      include: { company: { include: { users: { where: { role: 'admin', isActive: true } } } } },
    });

    for (const sub of expired) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'past_due' },
      });

      for (const admin of sub.company.users) {
        const lang = (admin as any).lang || 'fr';
        const dateStr = formatLongDate(sub.currentPeriodEnd, lang);
        await this.emailService.sendBillingExpired(
          admin.email,
          admin.firstName,
          dateStr,
          lang,
        );
      }

      this.logger.log(`Subscription ${sub.id} marked as past_due, notifications sent`);
    }
  }

  @Cron('0 4 * * *')
  async handleUnpaidSubscriptions() {
    if (this.configService.get<string>('BILLING_ENABLED') !== 'true') { this.logger.log('BILLING_ENABLED=false — skipping unpaid subscription follow-up'); return; }
    this.logger.log('Running unpaid subscription follow-up...');

    const unpaid = await this.prisma.subscription.findMany({
      where: {
        status: 'past_due',
        currentPeriodEnd: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
      include: { company: { include: { users: { where: { role: 'admin', isActive: true } } } } },
    });

    for (const sub of unpaid) {
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'unpaid' },
      });

      for (const admin of sub.company.users) {
        const lang = (admin as any).lang || 'fr';
        await this.emailService.sendBillingSuspended(
          admin.email,
          admin.firstName,
          lang,
        );
      }

      this.logger.log(`Subscription ${sub.id} marked as unpaid`);
    }
  }
}
