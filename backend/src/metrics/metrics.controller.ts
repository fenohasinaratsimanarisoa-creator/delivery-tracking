import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

@Controller('metrics')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class MetricsController {
  constructor(private metrics: MetricsService) {}

  @Get()
  @Header('Content-Type', 'text/plain; charset=utf-8')
  async index(): Promise<string> {
    return this.metrics.getMetrics();
  }
}
