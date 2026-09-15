import { Module } from '@nestjs/common';
import { ManualBillingController } from './manual-billing.controller';
import { ManualBillingService } from './manual-billing.service';

@Module({
  controllers: [ManualBillingController],
  providers: [ManualBillingService],
})
export class ManualBillingModule {}
