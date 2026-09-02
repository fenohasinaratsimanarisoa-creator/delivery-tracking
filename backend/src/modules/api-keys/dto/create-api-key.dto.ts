import {
  IsString,
  IsArray,
  IsOptional,
  IsDateString,
  IsIn,
  MinLength,
  MaxLength,
  ArrayNotEmpty,
  ArrayUnique,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { API_KEY_SCOPES } from '../api-key-scopes';

export class CreateApiKeyDto {
  @ApiProperty({
    description: 'Human-readable name to identify the key',
    example: 'Production Tracking Integration',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiProperty({
    description: 'Scopes accordés à la clé (lecture seule)',
    enum: API_KEY_SCOPES,
    isArray: true,
    example: ['deliveries:read', 'tracking:read'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(API_KEY_SCOPES as unknown as string[], {
    each: true,
    message: `Chaque scope doit être l'un de : ${API_KEY_SCOPES.join(', ')}`,
  })
  scopes: string[];

  @ApiPropertyOptional({
    description: 'ISO date when the key expires',
    example: '2027-07-22T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
