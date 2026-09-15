import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

export class SubmitPaymentProofDto {
  @IsUUID()
  claimedPlanId: string;

  @IsUUID()
  paymentMethodId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reference: string;
}
