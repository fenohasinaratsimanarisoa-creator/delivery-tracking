import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PaymentProofStatus } from '@prisma/client';
import { PaymentProofsService } from './payment-proofs.service';
import { RejectPaymentProofDto } from './dto/reject-payment-proof.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { SkipSubscriptionCheck } from '../../common/decorators/skip-subscription-check.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('platform-admin/payment-proofs')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@SkipSubscriptionCheck()
export class PaymentProofsController {
  constructor(private readonly paymentProofsService: PaymentProofsService) {}

  @Get()
  list(
    @Query('status') status: PaymentProofStatus | undefined,
    @Query('page') page: unknown,
    @Query('limit') limit: unknown,
  ) {
    return this.paymentProofsService.list(status, page, limit);
  }

  @Get(':id/image')
  async getImage(@Param('id') id: string, @Res() res: Response) {
    const { proofImage, proofImageMime } = await this.paymentProofsService.getImage(id);
    res.set({ 'Content-Type': proofImageMime, 'Content-Length': proofImage.length.toString() });
    res.send(proofImage);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser('id') adminId: string) {
    return this.paymentProofsService.approve(id, adminId);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() dto: RejectPaymentProofDto,
  ) {
    return this.paymentProofsService.reject(id, adminId, dto.reason);
  }
}
