import {
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ManualBillingService } from './manual-billing.service';
import { SubmitPaymentProofDto } from './dto/submit-payment-proof.dto';
import { RedeemCodeDto } from './dto/redeem-code.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CompanyScopeGuard } from '../../common/guards/company-scope.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { imageUploadMulterOptions } from '../../common/config/multer.config';

// Toutes les routes de ce contrôleur doivent rester utilisables MÊME quand la
// société est bloquée par SubscriptionGuard — c'est précisément l'écran de
// paiement qui doit permettre d'en sortir.
@Controller('manual-billing')
@UseGuards(JwtAuthGuard, CompanyScopeGuard)
@SkipSubscriptionCheck()
export class ManualBillingController {
  constructor(private readonly manualBillingService: ManualBillingService) {}

  @Get('status')
  getStatus(@CurrentUser('companyId') companyId: string) {
    return this.manualBillingService.getStatus(companyId);
  }

  @Get('plans')
  getPlans() {
    return this.manualBillingService.getPlans();
  }

  @Get('payment-methods')
  getPaymentMethods() {
    return this.manualBillingService.getPaymentMethods();
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Get('proofs/mine')
  getMyProofs(@CurrentUser('companyId') companyId: string) {
    return this.manualBillingService.getMyProofs(companyId);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post('proofs')
  @UseInterceptors(FileInterceptor('image', imageUploadMulterOptions))
  submitProof(
    @CurrentUser('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SubmitPaymentProofDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.manualBillingService.submitProof(companyId, userId, dto, file);
  }

  @UseGuards(RolesGuard)
  @Roles('admin')
  @Post('redeem')
  redeem(@CurrentUser('companyId') companyId: string, @Body() dto: RedeemCodeDto) {
    return this.manualBillingService.redeem(companyId, dto.code);
  }
}
