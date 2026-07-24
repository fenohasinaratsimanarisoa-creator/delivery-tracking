import { Controller, Get, Query, Res, UseGuards, Header } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('reports')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('delivery')
  getDeliveryReport(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getDeliveryReport(companyId, from, to);
  }

  @Get('fleet')
  getFleetReport(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getFleetReport(companyId, from, to);
  }

  @Get('driver')
  getDriverReport(
    @CurrentUser('companyId') companyId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reportsService.getDriverReport(companyId, from, to);
  }

  @Get('export/pdf')
  @Header('Content-Type', 'application/pdf')
  async exportPdf(
    @CurrentUser('companyId') companyId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type = 'all',
  ) {
    const pdf = await this.reportsService.exportPdf(type, companyId, from, to);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="rapport-${type}-${Date.now()}.pdf"`,
    );
    res.end(pdf);
  }

  @Get('export/excel')
  @Header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async exportExcel(
    @CurrentUser('companyId') companyId: string,
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('type') type = 'all',
  ) {
    const buffer = await this.reportsService.exportExcel(type, companyId, from, to);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="rapport-${type}-${Date.now()}.xlsx"`,
    );
    res.end(buffer);
  }
}
