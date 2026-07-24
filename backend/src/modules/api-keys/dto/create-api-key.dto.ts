import {
  IsString,
  IsArray,
  IsOptional,
  IsDateString,
  MinLength,
  MaxLength,
  ArrayNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
    description: 'Comma-separated scopes: deliveries:read, tracking:read',
    example: ['deliveries:read', 'tracking:read'],
  })
  @IsArray()
  @ArrayNotEmpty()
  scopes: string[];

  @ApiPropertyOptional({
    description: 'ISO date when the key expires',
    example: '2027-07-22T00:00:00Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
