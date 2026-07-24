import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiKeyResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'prod_tracking_key' })
  name: string;

  @ApiProperty({ example: 'dt_prod_a1b2c3d4' })
  prefix: string;

  @ApiProperty({ example: ['deliveries:read', 'tracking:read'] })
  scopes: string[];

  @ApiPropertyOptional({ example: '2027-07-22T00:00:00Z' })
  expiresAt?: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiPropertyOptional({ example: '2026-07-22T10:00:00Z' })
  lastUsedAt?: string;

  @ApiProperty({ example: '2026-07-22T10:00:00Z' })
  createdAt: string;
}

export class ApiKeyCreatedResponseDto extends ApiKeyResponseDto {
  @ApiProperty({
    example: 'dt_prod_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p',
    description: 'Full API key — shown only once',
  })
  key: string;
}
