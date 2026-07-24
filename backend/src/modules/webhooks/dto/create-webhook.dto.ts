import {
  IsString,
  IsArray,
  IsUrl,
  IsOptional,
  ArrayNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWebhookDto {
  @ApiProperty({
    description: 'HTTPS endpoint that will receive webhook payloads',
    example: 'https://api.client.com/webhooks/delivery-track',
  })
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['https'] })
  url: string;

  @ApiProperty({
    description: 'Events to subscribe to',
    example: ['delivery.status_changed', 'delivery.delivered'],
  })
  @IsArray()
  @ArrayNotEmpty()
  events: string[];

  @ApiPropertyOptional({
    description: 'Optional HMAC signing secret (auto-generated if empty)',
    example: 'whsec_abc123...',
  })
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  secret?: string;
}
