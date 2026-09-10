import { IsIn, IsOptional, IsString, IsDateString } from 'class-validator';

/**
 * Filtres de la synthèse carburant par période
 * (GET /fuel-consumption/summary).
 */
export class FuelSummaryQueryDto {
  /** Granularité d'agrégation. Défaut : `month`. */
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  groupBy?: 'day' | 'week' | 'month' | 'year';

  /** Restreint à un véhicule (sinon toute la flotte). */
  @IsOptional()
  @IsString()
  vehicleId?: string;

  /** Début de fenêtre (ISO). Défaut : dérivé de `groupBy`. */
  @IsOptional()
  @IsDateString()
  from?: string;

  /** Fin de fenêtre (ISO). Défaut : maintenant. */
  @IsOptional()
  @IsDateString()
  to?: string;
}
