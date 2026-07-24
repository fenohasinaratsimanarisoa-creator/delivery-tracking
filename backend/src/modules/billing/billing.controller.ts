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
  Res,
  HttpStatus,
  Req,
  Headers,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { BillingService } from './billing.service';
import { MobileMoneyService } from './mobile-money.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('billing')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('plans')
  getPlans() {
    return this.billingService.getPlans();
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.billingService.createPlan(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: Partial<CreatePlanDto>) {
    return this.billingService.updatePlan(id, dto);
  }

  @Get('subscription')
  getSubscription(@CurrentUser('companyId') companyId: string) {
    return this.billingService.getCompanySubscription(companyId);
  }

  @Post('subscription')
  @UseGuards(RolesGuard)
  @Roles('admin')
  createOrUpdateSubscription(
    @CurrentUser('companyId') companyId: string,
    @Body() dto: CreateCheckoutDto,
  ) {
    return this.billingService.createOrUpdateSubscription(companyId, dto);
  }

  @Post('subscription/cancel')
  @UseGuards(RolesGuard)
  @Roles('admin')
  cancelSubscription(@CurrentUser('companyId') companyId: string) {
    return this.billingService.cancelSubscription(companyId);
  }

  @Get('invoices')
  getInvoices(
    @CurrentUser('companyId') companyId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.billingService.getCompanyInvoices(companyId, +page, +limit);
  }

  @Get('invoices/:id')
  getInvoice(@Param('id') id: string, @CurrentUser('companyId') companyId: string) {
    return this.billingService.getInvoice(id, companyId);
  }

  @Get('invoices/:id/pdf')
  async downloadInvoice(
    @Param('id') id: string,
    @CurrentUser('companyId') companyId: string,
    @Res() res: Response,
  ) {
    const pdf = await this.billingService.downloadInvoicePdf(id, companyId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="facture-${id.slice(0, 8)}.pdf"`,
      'Content-Length': pdf.length.toString(),
    });
    res.status(HttpStatus.OK).send(pdf);
  }

  @Get('usage')
  getUsage(@CurrentUser('companyId') companyId: string) {
    return this.billingService.getCompanyUsage(companyId);
  }
}

@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(
    private readonly billingService: BillingService,
    private readonly mobileMoneyService: MobileMoneyService,
    private readonly configService: ConfigService,
  ) {}

  @Post('stripe')
  async handleStripeWebhook(@Req() req: Request, @Headers('stripe-signature') signature: string) {
    if (this.configService.get<string>('BILLING_ENABLED') !== 'true') {
      return { received: true, billingDisabled: true };
    }
    const payload = req.body as Buffer;
    await this.billingService.handleStripeWebhook(payload, signature);
    return { received: true };
  }

  @Post('mobile-money')
  async handleMobileMoneyWebhook(@Req() req: Request, @Headers('x-mm-signature') signature: string) {
    if (this.configService.get<string>('BILLING_ENABLED') !== 'true') {
      return { received: true, billingDisabled: true };
    }
    const rawBody = req.body as Buffer;
    const body = JSON.parse(rawBody.toString('utf8'));
    const provider = body.provider === 'orange_money' ? 'orange_money' : 'mvola';

    await this.billingService.verifyMobileMoneySignature(rawBody, signature, provider);

    const parsed = await this.mobileMoneyService.handleWebhook(body, provider as any);
    if (parsed && parsed.status === 'paid') {
      await this.billingService.confirmMobileMoney(parsed.transactionRef);
    }
    return { received: true };
  }
}
