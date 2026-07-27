import { IsArray, IsString, IsIn, IsOptional, IsUUID, ArrayNotEmpty } from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

const VALID_ACTIONS = ['delete', 'updateStatus', 'assignDriver'] as const;

export class BulkActionDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];

  @IsString()
  @IsIn(VALID_ACTIONS)
  action: typeof VALID_ACTIONS[number];

  @IsOptional()
  @IsString()
  @IsIn(Object.values(DeliveryStatus))
  status?: string;

  @IsOptional()
  @IsString()
  driverId?: string;
}
