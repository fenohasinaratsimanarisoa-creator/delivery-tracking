import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { DriversService } from './drivers.service';
import { CreateDriverDto } from './dto/create-driver.dto';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('drivers')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class DriversController {
  constructor(private readonly driversService: DriversService) {}

  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateDriverDto) {
    return this.driversService.create(companyId, dto);
  }

  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.driversService.findAll(companyId, +page, +limit);
  }

  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.driversService.findOne(companyId, id);
  }

  @Patch(':id')
  update(@CurrentUser('companyId') companyId: string, @Param('id') id: string, @Body() dto: UpdateDriverDto) {
    return this.driversService.update(companyId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.driversService.remove(companyId, id);
  }
}
