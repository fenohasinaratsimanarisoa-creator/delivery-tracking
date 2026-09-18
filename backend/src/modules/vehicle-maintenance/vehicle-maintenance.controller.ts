import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { CreateMaintenanceScheduleDto } from './dto/create-maintenance-schedule.dto';
import { UpdateMaintenanceScheduleDto } from './dto/update-maintenance-schedule.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

// Pas de préfixe @Controller commun : les routes touchent à la fois
// /vehicles/:vehicleId/maintenance-schedules (créer/lister pour un véhicule,
// cohérent avec le reste de l'API véhicule) et /maintenance-schedules/:id
// (modifier/supprimer une règle précise, id seul suffit) — chemins complets
// explicites sur chaque méthode plutôt qu'un préfixe ambigu.
@Controller()
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
export class VehicleMaintenanceController {
  constructor(private readonly service: VehicleMaintenanceService) {}

  @Roles('admin', 'dispatcher')
  @Get('vehicles/:vehicleId/maintenance-schedules')
  findAllForVehicle(
    @CurrentUser('companyId') companyId: string,
    @Param('vehicleId') vehicleId: string,
  ) {
    return this.service.findAllForVehicle(companyId, vehicleId);
  }

  @Roles('admin', 'dispatcher')
  @Post('vehicles/:vehicleId/maintenance-schedules')
  create(
    @CurrentUser('companyId') companyId: string,
    @Param('vehicleId') vehicleId: string,
    @Body() dto: CreateMaintenanceScheduleDto,
  ) {
    return this.service.create(companyId, vehicleId, dto);
  }

  @Roles('admin', 'dispatcher')
  @Get('maintenance-schedules/due-soon')
  findDueSoon(@CurrentUser('companyId') companyId: string) {
    return this.service.findDueSoon(companyId);
  }

  @Roles('admin', 'dispatcher')
  @Patch('maintenance-schedules/:id')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateMaintenanceScheduleDto,
  ) {
    return this.service.update(companyId, id, dto);
  }

  @Roles('admin', 'dispatcher')
  @Delete('maintenance-schedules/:id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.service.remove(companyId, id);
  }
}
