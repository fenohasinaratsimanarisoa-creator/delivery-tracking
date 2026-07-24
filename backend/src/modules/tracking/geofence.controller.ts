import { Controller, Get, Post, Body, Param, Delete, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Geofences')
@Controller('geofences')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@ApiBearerAuth()
export class GeofenceController {
  constructor(private prisma: PrismaService) {}

  @Post()
  @ApiOperation({ summary: 'Create a geofence for a delivery' })
  async create(
    @CurrentUser('companyId') companyId: string,
    @Body()
    data: { deliveryId: string; name: string; lat: number; lng: number; radiusMeters: number },
  ) {
    return this.prisma.geofence.create({
      data: { companyId, ...data },
    });
  }

  @Get('delivery/:deliveryId')
  @ApiOperation({ summary: 'List geofences for a delivery' })
  async findByDelivery(
    @CurrentUser('companyId') companyId: string,
    @Param('deliveryId') deliveryId: string,
  ) {
    return this.prisma.geofence.findMany({
      where: { companyId, deliveryId },
    });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a geofence' })
  async delete(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.prisma.geofence.deleteMany({
      where: { id, companyId },
    });
  }
}
