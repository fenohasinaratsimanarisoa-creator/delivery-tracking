import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleFilterDto } from './dto/vehicle-filter.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsageGuard } from '../../common/guards/usage.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('vehicles')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @UseGuards(RolesGuard, UsageGuard)
  @Roles('admin', 'dispatcher')
  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateVehicleDto) {
    return this.vehiclesService.create(companyId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get()
  findAll(@CurrentUser('companyId') companyId: string, @Query() filter: VehicleFilterDto) {
    return this.vehiclesService.findAll(companyId, filter);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get('list')
  findAllSimple(@CurrentUser('companyId') companyId: string) {
    return this.vehiclesService.findAllSimple(companyId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get('available-traccar-devices')
  getAvailableTraccarDevices(@CurrentUser('companyId') companyId: string) {
    return this.vehiclesService.getAvailableTraccarDevices(companyId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Post('traccar-devices')
  createTraccarDevice(@Body('name') name: string, @Body('uniqueId') uniqueId: string) {
    return this.vehiclesService.createTraccarDevice(name, uniqueId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.vehiclesService.findOne(companyId, id);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Patch(':id')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ) {
    return this.vehiclesService.update(companyId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.vehiclesService.remove(companyId, id);
  }
}
