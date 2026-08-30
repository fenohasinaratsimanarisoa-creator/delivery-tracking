import {
  IsString,
  IsNumber,
  Min,
  Max,
  IsDateString,
  IsOptional,
  MinLength,
  MaxLength,
} from 'class-validator';
import { IsPlausibleTimestamp } from '../../../common/validators/plausible-timestamp';

/**
 * Position reçue par relais SMS (canal de secours zéro-connectivité, audit
 * 2026-08-27) : quand un téléphone chauffeur n'a ni data ni WiFi, il envoie sa
 * position par SMS à un téléphone-passerelle fixe (au bureau, avec sa propre
 * connexion) — voir GatewaySmsReceiver.java (Android). Ce téléphone relaie
 * chaque SMS reçu vers CET endpoint.
 *
 * PAS de vehicleId ici : le SMS ne peut pas transporter un UUID (36 caractères
 * consommeraient une part disproportionnée d'un SMS de 160 caractères). Le
 * véhicule est résolu côté serveur à partir du NUMÉRO D'ENVOI du SMS
 * (senderPhone), rapproché de Driver.phone — voir
 * TrackingService.ingestSmsRelayPosition.
 */
export class SmsRelayPositionDto {
  // Aucune contrainte de format stricte ici : les numéros malgaches arrivent
  // dans des formats variables selon l'opérateur/le SDK Android
  // (getOriginatingAddress()) — la normalisation (retrait espaces/tirets/indicatif
  // pays) se fait côté service, pas ici.
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  senderPhone: string;

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
  @Max(1000)
  accuracy?: number;

  @IsDateString()
  @IsPlausibleTimestamp()
  timestamp: string;
}
