import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleFilterDto } from './dto/vehicle-filter.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(companyId, dto);
  }

  @Get()
  findAll(@CurrentUser('companyId') companyId: string, @Query() filter: VehicleFilterDto) {
    return this.vehiclesService.findAll(companyId, filter);
  }

  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.vehiclesService.findOne(companyId, id);
  }

  @Patch(':id')
  update(@CurrentUser('companyId') companyId: string, @Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehiclesService.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.vehiclesService.remove(companyId, id);
  }
}
