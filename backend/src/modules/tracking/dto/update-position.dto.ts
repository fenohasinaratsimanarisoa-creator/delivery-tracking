import {
  IsNumber,
  Min,
  Max,
  IsDateString,
  IsOptional,
  IsArray,
  IsUUID,
  ArrayMaxSize,
} from 'class-validator';
import { IsPlausibleTimestamp } from '../../../common/validators/plausible-timestamp';

/**
 * Taille maximale d'un lot de positions. Alignée sur BATCH_LIMIT du worker natif
 * (PositionUploadWorker.BATCH_LIMIT = 200) et sur BATCH_CHUNK_SIZE du client JS,
 * avec une marge. Sans cette borne, un client authentifié pouvait poster un
 * tableau arbitrairement grand (seule la limite body-parser de 100 ko freinait).
 */
export const MAX_BATCH_POSITIONS = 500;

export class UpdatePositionDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  altitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000) // 1000m = seuil maximal d'une précision GPS exploitable ; au-delà c'est un fix invalide
  accuracy?: number;

  @IsDateString()
  @IsPlausibleTimestamp()
  timestamp: string;

  @IsOptional()
  @IsUUID('4')
  deliveryId?: string;

  @IsUUID('4')
  vehicleId: string;
}

/**
 * Lot de positions (chemin natif REST et chemin WebSocket 'batchPosition').
 *
 * ABSENCE VOLONTAIRE de @ValidateNested + @Type (audit GPS 2026-08-28, A6) —
 * ne PAS les ajouter :
 *
 * Le ValidationPipe global rejetterait alors le lot ENTIER (400) dès qu'UNE
 * seule position est invalide. Comme le worker natif renvoie toujours le même
 * lot le plus ancien en premier (getUnsyncedBatch, timestamp ASC), une unique
 * position définitivement invalide bloquerait DÉFINITIVEMENT la file entière
 * (head-of-line blocking) : plus aucune position, même récente, ne pourrait
 * jamais être envoyée.
 *
 * La validation se fait donc POSITION PAR POSITION dans
 * TrackingService.validateAndSaveBatch, qui accepte les valides, signale
 * explicitement les invalides à l'appelant (voir son type de retour
 * `rejected`), et ne perd jamais rien silencieusement.
 *
 * Seules les contraintes portant sur le TABLEAU LUI-MÊME sont déclarées ici.
 */
export class BatchPositionDto {
  @IsArray()
  @ArrayMaxSize(MAX_BATCH_POSITIONS)
  positions: UpdatePositionDto[];
}
