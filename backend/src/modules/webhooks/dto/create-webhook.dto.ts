import {
  IsString,
  IsArray,
  IsUrl,
  IsOptional,
  IsIn,
  ArrayNotEmpty,
  ArrayUnique,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WEBHOOK_EVENTS } from '../webhook-events';

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
    enum: WEBHOOK_EVENTS,
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  @IsIn(WEBHOOK_EVENTS as unknown as string[], {
    each: true,
    message: `Chaque événement doit être l'un de : ${WEBHOOK_EVENTS.join(', ')}`,
  })
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
