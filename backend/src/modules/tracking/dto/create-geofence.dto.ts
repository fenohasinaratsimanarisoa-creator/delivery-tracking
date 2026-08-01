import { IsNumber, IsString, IsUUID, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreateGeofenceDto {
  @IsUUID('4')
  deliveryId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;

  // rayon en mètres.
  // Minimum 10 m : un rayon plus petit est incohérent avec le bruit GPS (~5-10m) et
  // rendrait `distance <= radiusMeters` toujours faux → aucun événement d'entrée/sortie
  // ne serait jamais déclenché (bug #4), sans aucune erreur visible côté client.
  // Maximum 100 km : au-delà, la géofence couvre une région entière et la notion
  // d'entrée/sortie d'une zone de livraison perd son sens (limite justifiée, pas
  // arbitraire — aucune géofence existante en base ne dépasse cette valeur).
  @IsNumber()
  @Min(10, { message: 'radiusMeters doit être supérieur ou égal à 10 mètres' })
  @Max(100000, {
    message: 'radiusMeters doit être inférieur ou égal à 100 000 mètres (100 km)',
  })
  radiusMeters: number;
}
