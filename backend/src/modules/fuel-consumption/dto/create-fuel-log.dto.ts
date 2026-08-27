import { IsNumber, IsString, IsOptional, Min, IsPositive, IsUUID, MaxLength, IsDateString } from 'class-validator';
import { IsPlausibleFuelDate } from '../../../common/validators/plausible-fuel-date';

export class CreateFuelLogDto {
  // BUG CORRIGÉ (audit carburant 2026-08-27, MOYENNE) : @Min(0) acceptait un
  // "plein" de 0 litre comme valide — sémantiquement incohérent (un plein
  // enregistre du carburant ajouté, jamais zéro). IsPositive() exige > 0.
  @IsNumber()
  @IsPositive()
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
  // IsPlausibleFuelDate (audit 2026-08-27, HAUTE) : borne la fenêtre acceptée
  // (pas plus d'1 jour dans le futur, pas plus de 10 ans dans le passé) — voir
  // common/validators/plausible-fuel-date.ts pour le pourquoi détaillé.
  @IsDateString()
  @IsPlausibleFuelDate()
  fillDate: string;

  // BUG CORRIGÉ (audit carburant 2026-08-27, FAIBLE) : @IsString() seul,
  // incohérent avec la convention établie ailleurs dans le module GPS
  // (UpdatePositionDto.vehicleId en @IsUUID('4')). Sans conséquence de
  // sécurité (la requête Prisma qui suit filtre déjà par companyId), mais
  // rigueur de validation alignée sur le reste du codebase.
  @IsUUID('4')
  vehicleId: string;

  @IsOptional()
  @IsString()
  // BUG CORRIGÉ (audit carburant 2026-08-27, FAIBLE) : aucune limite de
  // longueur — vecteur de payload arbitrairement volumineux.
  @MaxLength(2000)
  notes?: string;
}
