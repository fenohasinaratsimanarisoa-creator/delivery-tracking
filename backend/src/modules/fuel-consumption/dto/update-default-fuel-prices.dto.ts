import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// Prix par défaut par type de carburant (Ariary/litre).
// Clés FIXES (whitelist) : toute clé inconnue est rejetée par le ValidationPipe
// (forbidNonWhitelisted). Bornes ajustées au marché malgache réel (~4 900-5 000
// Ariary/litre) : max 50 000 Ar/L pour laisser de la marge, hors valeurs absurdes.
export class UpdateDefaultFuelPricesDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  essence?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  gasoil?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  diesel?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  electric?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(50000)
  hybrid?: number;
}
