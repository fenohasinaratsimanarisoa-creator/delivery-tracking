import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

const PAYMENT_METHOD_PROVIDERS = ['mvola', 'orange_money'] as const;

export class CreatePaymentMethodDto {
  @IsIn(PAYMENT_METHOD_PROVIDERS)
  provider: (typeof PAYMENT_METHOD_PROVIDERS)[number];

  @IsString()
  @MinLength(6)
  phoneNumber: string;

  @IsString()
  @MinLength(2)
  holderName: string;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsIn(PAYMENT_METHOD_PROVIDERS)
  provider?: (typeof PAYMENT_METHOD_PROVIDERS)[number];

  @IsOptional()
  @IsString()
  @MinLength(6)
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  holderName?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
