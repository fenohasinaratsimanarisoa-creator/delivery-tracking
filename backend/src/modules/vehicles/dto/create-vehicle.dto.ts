import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsIn,
  Matches,
} from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  brand: string;

  @IsString()
  @MinLength(1)
  model: string;

  @IsInt()
  @Min(1990)
  @Max(2030)
  year: number;

  @IsString()
  @MinLength(1)
  licensePlate: string;

  @IsString()
  @IsOptional()
  vin?: string;

  @IsString()
  fuelType: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  theoreticalConsumption?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['phone', 'physical_tracker'])
  positionSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  traccarDeviceId?: string;

  // IMEI du traceur GPS physique (étiquette du boîtier). Fourni SEUL (sans
  // traccarDeviceId), il déclenche la création automatique du device Traccar
  // côté serveur — l'admin n'a plus qu'à saisir ce numéro, tout le reste
  // (création + liaison) est automatique. `traccarDeviceId`, s'il est fourni
  // explicitement, reste prioritaire (sélection manuelle d'un device déjà
  // existant, cf. GET /vehicles/available-traccar-devices).
  @IsOptional()
  @IsString()
  @Matches(/^\d{14,16}$/, { message: 'IMEI invalide (14 à 16 chiffres attendus)' })
  imei?: string;
}
