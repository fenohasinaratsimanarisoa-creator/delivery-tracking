import {
  IsArray,
  IsString,
  IsIn,
  IsOptional,
  ArrayNotEmpty,
  ArrayMaxSize,
  IsUUID,
} from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

const VALID_ACTIONS = ['delete', 'updateStatus', 'assignDriver'] as const;

export class BulkActionDto {
  @IsArray()
  @ArrayNotEmpty()
  // Borne dure : sans elle, `delivery.findMany({ where: { id: { in: ids } } })`
  // acceptait un tableau arbitrairement grand (DoS applicatif). 500 = large marge
  // au-dessus de tout usage réel (sélection d'une page du tableau de bord).
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  ids: string[];

  @IsString()
  @IsIn(VALID_ACTIONS)
  action: (typeof VALID_ACTIONS)[number];

  @IsOptional()
  @IsString()
  @IsIn(Object.values(DeliveryStatus))
  status?: string;

  @IsOptional()
  @IsUUID('4')
  driverId?: string;
}
