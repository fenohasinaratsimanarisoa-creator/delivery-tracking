import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateUserDto) {
    return this.usersService.create(companyId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 20,
  ) {
    return this.usersService.findAll(companyId, +page, +limit);
  }

  @Get('me')
  getProfile(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Get(':id')
  findOne(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(companyId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser('id') currentUserId: string,
  ) {
    return this.usersService.remove(companyId, id, currentUserId);
  }
}
