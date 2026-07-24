import { IsString, IsEnum, IsOptional } from 'class-validator';
import { BillingProvider } from '@prisma/client';

export class CreateCheckoutDto {
  @IsString()
  planId: string;

  @IsEnum(BillingProvider)
  provider: BillingProvider;

  @IsOptional()
  @IsString()
  mobileMoneyPhone?: string;
}
