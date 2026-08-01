import { IsString, IsNumber, IsOptional, Min, IsDateString } from 'class-validator';

export class UpdateFuelPriceDto {
  @IsOptional()
  @IsString()
  fuelType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pricePerLiter?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string | null;
}
