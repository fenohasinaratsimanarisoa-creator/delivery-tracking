import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingController, BillingWebhookController } from './billing.controller';
import { BillingService } from './billing.service';
import { StripeService } from './stripe.service';
import { MobileMoneyService } from './mobile-money.service';
import { InvoicePdfService } from './invoice-pdf.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [ScheduleModule, EmailModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService, StripeService, MobileMoneyService, InvoicePdfService],
  exports: [BillingService],
})
export class BillingModule {}
