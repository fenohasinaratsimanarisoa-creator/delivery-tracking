import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { OnboardingController } from './onboarding.controller';

@Module({
  controllers: [DashboardController, OnboardingController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
