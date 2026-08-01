import { IsString, IsNumber, IsOptional, Min, IsDateString } from 'class-validator';

export class CreateFuelPriceDto {
  @IsString()
  fuelType: string;

  @IsNumber()
  @Min(0)
  pricePerLiter: number;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}
