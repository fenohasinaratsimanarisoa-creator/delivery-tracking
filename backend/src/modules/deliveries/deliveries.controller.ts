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
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DeliveryStatus } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { UpdateDeliveryDto } from './dto/update-delivery.dto';
import { UpdateDeliveryStatusDto } from './dto/update-delivery-status.dto';
import { BulkActionDto } from './dto/bulk-action.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UsageGuard } from '../../common/guards/usage.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { normalizePagination } from '../../common/utils/pagination';

@Controller('deliveries')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class DeliveriesController {
  constructor(private readonly deliveriesService: DeliveriesService) {}

  @UseGuards(RolesGuard, UsageGuard)
  @Roles('admin', 'dispatcher')
  @Post()
  create(@CurrentUser('companyId') companyId: string, @Body() dto: CreateDeliveryDto) {
    return this.deliveriesService.create(companyId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Post('import')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @CurrentUser('companyId') companyId: string,
    @UploadedFile() file: Express.Multer.File,
    @Query('mode') mode?: string,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    if (!file.originalname.match(/\.xlsx$/i))
      throw new BadRequestException('Format de fichier invalide, .xlsx attendu');
    const defaultPickupAddress = process.env.DEFAULT_PICKUP_ADDRESS || 'Entrepôt principal';
    return this.deliveriesService.importExcel(
      companyId,
      file.buffer,
      defaultPickupAddress,
      mode === 'upsert' ? 'upsert' : 'create-only',
    );
  }

  @UseGuards(RolesGuard)
  @Roles('client')
  @Get('my-orders')
  findMyOrders(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
  ) {
    const { page: p, limit: l } = normalizePagination(page, limit);
    return this.deliveriesService.findMyOrders(userId, companyId, p, l);
  }

  @Get('my-deliveries')
  findMyDeliveries(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
  ) {
    const { page: p, limit: l } = normalizePagination(page, limit);
    return this.deliveriesService.findMyDeliveries(userId, companyId, p, l);
  }

  @UseGuards(RolesGuard)
  @Roles('driver')
  @Patch(':id/driver-status')
  updateDriverStatus(
    @CurrentUser('id') userId: string,
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveriesService.updateDriverStatus(companyId, id, userId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get()
  findAll(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
    @Query('status') status?: DeliveryStatus,
  ) {
    const { page: p, limit: l } = normalizePagination(page, limit);
    return this.deliveriesService.findAll(companyId, p, l, status);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Get('proofs')
  getProofs(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page?: unknown,
    @Query('limit') limit?: unknown,
    @Query('status') status?: string,
  ) {
    const { page: p, limit: l } = normalizePagination(page, limit);
    return this.deliveriesService.findProofs(companyId, p, l, status);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher', 'driver', 'client')
  @Get(':id')
  findOne(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.deliveriesService.findOne(companyId, id, role, userId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Patch(':id')
  update(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryDto,
  ) {
    return this.deliveriesService.update(companyId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateDeliveryStatusDto,
  ) {
    return this.deliveriesService.updateStatus(companyId, id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Patch(':id/resolve-mismatch')
  resolveMismatch(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.deliveriesService.resolveMismatch(companyId, id);
  }

  @UseGuards(RolesGuard)
  @Roles('admin', 'dispatcher')
  @Post('bulk-action')
  async bulkAction(@CurrentUser('companyId') companyId: string, @Body() dto: BulkActionDto) {
    return this.deliveriesService.bulkAction(companyId, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Delete(':id')
  remove(@CurrentUser('companyId') companyId: string, @Param('id') id: string) {
    return this.deliveriesService.remove(companyId, id);
  }
}
