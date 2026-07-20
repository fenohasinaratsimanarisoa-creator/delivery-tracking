import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('tracking')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

  @Get('positions/:deliveryId')
  getPositions(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.getPositionsByDelivery(deliveryId, companyId);
  }

  @Get('distance/:deliveryId')
  getDistance(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.calculateDistance(deliveryId, companyId);
  }
}
