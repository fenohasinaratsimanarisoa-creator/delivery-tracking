import { IsString, IsNumber, IsOptional, Min, Max, IsDateString } from 'class-validator';

export class CreateFuelPriceDto {
  @IsString()
  fuelType: string;

  // BUG CORRIGÉ (audit carburant 2026-08-27, HAUTE) : @Min(0) seul, sans borne
  // haute — contrairement à UpdateDefaultFuelPricesDto qui plafonne à 50 000
  // Ar/L "hors valeurs absurdes" (marché malgache réel ~4 900-5 000 Ar/L). Une
  // erreur de saisie (un zéro de trop) sur CE point d'entrée — le plus
  // consulté, utilisé pour TOUS les calculs de coût réels — n'était pourtant
  // pas protégée. Même borne que les prix par défaut, pour cohérence.
  @IsNumber()
  @Min(0)
  @Max(50000)
  pricePerLiter: number;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsDateString()
  effectiveUntil?: string;
}
