import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, CompanyScopeGuard, RolesGuard)
@Roles('admin', 'dispatcher')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  getKpis(@CurrentUser('companyId') companyId: string) {
    return this.dashboardService.getKpis(companyId);
  }

  @Get('delivery-stats')
  getDeliveryStats(@CurrentUser('companyId') companyId: string) {
    return this.dashboardService.getDeliveryStats(companyId);
  }

  @Get('fuel-chart')
  getFuelChart(@CurrentUser('companyId') companyId: string) {
    return this.dashboardService.getFuelStatsForChart(companyId);
  }

  @Get('reliability-score')
  getReliabilityScore(@CurrentUser('companyId') companyId: string) {
    return this.dashboardService.getReliabilityScore(companyId);
  }

  @Get('export/pdf')
  async exportPdf(@CurrentUser('companyId') companyId: string, @Res() res: Response) {
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const kpis = await this.dashboardService.getKpis(companyId);

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([595, 842]);
    const { width, height } = page.getSize();

    page.drawText('Delivery Tracking - Report', {
      x: 50,
      y: height - 50,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });

    let y = height - 100;
    const lineHeight = 20;

    const items = [
      `Date: ${new Date().toLocaleDateString()}`,
      `Deliveries Today: ${kpis.deliveriesToday}`,
      `Total Deliveries: ${kpis.totalDeliveries}`,
      `Active Vehicles: ${kpis.activeVehicles}`,
      `Active Drivers: ${kpis.activeDrivers}`,
      `Anomalies: ${kpis.anomalies}`,
      `Avg Consumption: ${kpis.fuelStats.averageConsumption.toFixed(2)} L/100km`,
      `Total Fuel: ${kpis.fuelStats.totalLiters.toFixed(1)} L`,
      `Total Distance: ${kpis.fuelStats.totalKilometers.toFixed(0)} km`,
    ];

    for (const item of items) {
      page.drawText(item, { x: 50, y, size: 12, font, color: rgb(0, 0, 0) });
      y -= lineHeight;
    }

    const pdfBytes = await doc.save();
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="dashboard-report-${Date.now()}.pdf"`,
      'Cache-Control': 'no-cache',
    });
    res.send(Buffer.from(pdfBytes));
  }

  @Get('export/excel')
  async exportExcel(@CurrentUser('companyId') companyId: string, @Res() res: Response) {
    const ExcelJS = await import('exceljs');
    const kpis = await this.dashboardService.getKpis(companyId);
    const deliveryStats = await this.dashboardService.getDeliveryStats(companyId);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Dashboard');

    sheet.columns = [
      { header: 'Metric', key: 'metric', width: 25 },
      { header: 'Value', key: 'value', width: 15 },
    ];

    sheet.addRows([
      { metric: 'Date', value: new Date().toLocaleDateString() },
      { metric: 'Deliveries Today', value: kpis.deliveriesToday },
      { metric: 'Total Deliveries', value: kpis.totalDeliveries },
      { metric: 'Active Vehicles', value: kpis.activeVehicles },
      { metric: 'Active Drivers', value: kpis.activeDrivers },
      { metric: 'Anomalies', value: kpis.anomalies },
      { metric: 'Avg Consumption (L/100km)', value: kpis.fuelStats.averageConsumption.toFixed(2) },
      { metric: 'Total Fuel (L)', value: kpis.fuelStats.totalLiters.toFixed(1) },
      { metric: 'Total Distance (km)', value: kpis.fuelStats.totalKilometers.toFixed(0) },
    ]);

    // Add delivery stats section
    const statsSheet = workbook.addWorksheet('Delivery Status');
    statsSheet.columns = [
      { header: 'Status', key: 'status', width: 20 },
      { header: 'Count', key: 'count', width: 10 },
    ];
    statsSheet.addRows(deliveryStats);

    const buffer = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="dashboard-report-${Date.now()}.xlsx"`,
      'Cache-Control': 'no-cache',
    });
    res.send(buffer);
  }
}
