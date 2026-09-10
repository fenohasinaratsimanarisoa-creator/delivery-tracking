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

  /**
   * Source des chiffres :
   *  - `logs` : pleins réellement saisis (FuelLog) ;
   *  - `gps`  : estimation à partir des trajets GPS (DailyFuelReport).
   * Défaut : `logs` si des pleins existent sur la période, sinon `gps`.
   */
  @IsOptional()
  @IsIn(['logs', 'gps'])
  source?: 'logs' | 'gps';

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
