import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateGeofenceDto } from './dto/create-geofence.dto';

@ApiTags('Geofences')
@Controller('geofences')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@ApiBearerAuth()
export class GeofenceController {
  constructor(private prisma: PrismaService) {}

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Post()
  @ApiOperation({ summary: 'Create a geofence for a delivery' })
  async create(@CurrentUser('companyId') companyId: string, @Body() data: CreateGeofenceDto) {
    if (data.deliveryId) {
      const delivery = await this.prisma.delivery.findUnique({
        where: { id: data.deliveryId },
        select: { companyId: true },
      });
      if (!delivery) throw new NotFoundException('Delivery not found');
      if (delivery.companyId !== companyId) {
        throw new ForbiddenException('Delivery does not belong to your company');
      }
    }
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

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a geofence' })
  async delete(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.prisma.geofence.deleteMany({
      where: { id, companyId },
    });
  }
}
