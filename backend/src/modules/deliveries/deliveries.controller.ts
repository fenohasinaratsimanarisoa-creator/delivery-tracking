import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('deliveries')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateDeliveryDto) {
    return this.deliveriesService.create(companyId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
    @Query('status') status?: DeliveryStatus,
  ) {
    return this.deliveriesService.findAll(companyId, +page, +limit, status);
  }

  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.deliveriesService.findOne(companyId, id);
  }

  @Patch(':id')
  update(@CurrentUser('companyId') companyId: string, @Param('id') id: string, @Body() dto: UpdateDeliveryDto) {
    return this.deliveriesService.update(companyId, id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveriesService.updateStatus(companyId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.deliveriesService.remove(companyId, id);
  }
}
