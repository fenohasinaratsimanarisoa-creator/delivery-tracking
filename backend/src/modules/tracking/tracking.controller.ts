import { Controller, Get, Post, Body, Param, UseGuards, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @Get('positions/:deliveryId')
  getPositions(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.getPositionsByDelivery(deliveryId, companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @Get('distance/:deliveryId')
  getDistance(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.trackingService.calculateDistance(deliveryId, companyId);
  }

  @UseGuards(JwtAuthGuard, CompanyScopeGuard)
  @Post('public-token')
  async generatePublicToken(
    @CurrentUser('companyId') companyId: string,
    @Body('deliveryId') deliveryId: string,
  ) {
    // Verify delivery exists and belongs to company
    await this.trackingService.getPositionsByDelivery(deliveryId, companyId);

    const token = this.jwtService.sign(
      { deliveryId, companyId, scope: 'public-tracking' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        expiresIn: '24h',
      },
    );
    return {
      trackingUrl: `/tracking/${token}`,
      token,
      expiresIn: '24h',
    };
  }

  @Get('public/:token')
  async getPublicTrackingInfo(@Param('token') token: string) {
    try {
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      });

      if (payload.scope !== 'public-tracking') {
        throw new UnauthorizedException('Invalid token scope');
      }

      const delivery = await this.trackingService.getDeliveryInfo(
        payload.deliveryId,
        payload.companyId,
      );
      const positions = await this.trackingService.getPositionsByDelivery(
        payload.deliveryId,
        payload.companyId,
      );

      return { delivery, positions };
    } catch {
      throw new UnauthorizedException('Invalid or expired tracking link');
    }
  }
}
