import { IsNumber, IsString, IsOptional, Min, IsDateString } from 'class-validator';

export class CreateFuelLogDto {
  @IsNumber()
  @Min(0)
  liters: number;

  @IsNumber()
  @Min(0)
  kilometers: number;

  @IsNumber()
  @Min(0)
  cost: number;

  // IsDateString (au lieu d'IsString) : une chaîne invalide ("2026-13-99"…) passait la
  // validation puis produisait un Invalid Date envoyé à Prisma → 500. Le front envoie
  // toujours un ISO (toISOString), et les dates "YYYY-MM-DD" sont aussi acceptées.
  @IsDateString()
  fillDate: string;

  @IsString()
  vehicleId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
