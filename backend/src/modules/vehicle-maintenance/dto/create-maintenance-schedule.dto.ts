import { IsString, IsOptional, IsInt, Min, MinLength, MaxLength } from 'class-validator';

export class CreateMaintenanceScheduleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  label: string;

  // Texte libre, même convention que MaintenanceRecord.type existant (ex.
  // "vidange", "revision", "pneus", "controle_technique") — sert à retrouver
  // le dernier MaintenanceRecord correspondant pour calculer le décompte.
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  type: string;

  // Au moins un des deux requis — vérifié dans le service (BadRequestException),
  // pas ici : class-validator ne fait pas facilement de "au moins un de ces
  // deux champs" sans décorateur custom, et un message d'erreur métier clair
  // ("précisez un intervalle en km et/ou en mois") vaut mieux qu'un message
  // générique de validation de forme.
  @IsOptional()
  @IsInt()
  @Min(1)
  intervalKm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  intervalMonths?: number;
}
