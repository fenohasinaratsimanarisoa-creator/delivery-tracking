import { IsString, IsNumber, IsOptional, Min, Max, IsDateString } from 'class-validator';

export class UpdateFuelPriceDto {
  @IsOptional()
  @IsString()
  fuelType?: string;

  // Voir create-fuel-price.dto.ts (audit carburant 2026-08-27, HAUTE) — même
  // borne haute que la création, pour la même raison.
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  pricePerLiter?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string | null;
}
