import { Controller, Get, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('onboarding')
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
@Roles('admin', 'dispatcher')
export class OnboardingController {
  constructor(private prisma: PrismaService) {}

  @Get('status')
  async getStatus(@CurrentUser('companyId') companyId: string) {
    const [vehicles, drivers, deliveries, preferences] = await Promise.all([
      this.prisma.vehicle.count({ where: { companyId, deletedAt: null } }),
      this.prisma.driver.count({ where: { companyId, deletedAt: null } }),
      this.prisma.delivery.count({ where: { companyId } }),
      this.prisma.userPreferences.count({ where: { user: { companyId } } }),
    ]);

    return {
      add_vehicle: vehicles > 0,
      invite_driver: drivers > 0,
      create_delivery: deliveries > 0,
      configure_notifications: preferences > 0,
    };
  }
}
