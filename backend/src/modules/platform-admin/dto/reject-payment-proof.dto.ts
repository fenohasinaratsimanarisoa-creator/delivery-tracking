import { IsString, MinLength, MaxLength } from 'class-validator';

export class RejectPaymentProofDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}
