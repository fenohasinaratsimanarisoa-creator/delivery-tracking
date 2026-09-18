import { IsArray, ArrayNotEmpty, ArrayMinSize, ArrayMaxSize, IsUUID } from 'class-validator';

export class OptimizeTourDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(2)
  // Même borne que OptimizeTripDto.coordinates côté routing (limite OSRM /trip/
  // raisonnable pour une tournée d'un seul chauffeur, pas un DoS applicatif).
  @ArrayMaxSize(25)
  @IsUUID('4', { each: true })
  ids: string[];
}
