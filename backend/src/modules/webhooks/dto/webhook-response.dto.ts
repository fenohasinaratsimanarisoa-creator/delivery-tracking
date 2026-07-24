import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class WebhookDeliveryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'delivery.status_changed' })
  event: string;

  @ApiProperty({ example: 'success' })
  status: string;

  @ApiPropertyOptional({ example: 200 })
  responseStatusCode?: number;

  @ApiProperty({ example: 0 })
  attempts: number;

  @ApiProperty({ example: '2026-07-22T10:00:00Z' })
  createdAt: string;
}

export class WebhookResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'https://api.client.com/webhooks/delivery-track' })
  url: string;

  @ApiProperty({ example: ['delivery.status_changed', 'delivery.delivered'] })
  events: string[];

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: '2026-07-22T10:00:00Z' })
  createdAt: string;

  @ApiPropertyOptional({ type: [WebhookDeliveryDto] })
  recentDeliveries?: WebhookDeliveryDto[];
}

export class WebhookCreatedResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @ApiProperty({ example: 'whsec_abc123...', description: 'The HMAC secret — shown only once' })
  secret: string;

  @ApiProperty({ example: 'https://api.client.com/webhooks/delivery-track' })
  url: string;

  @ApiProperty({ example: ['delivery.status_changed'] })
  events: string[];

  @ApiProperty({ example: true })
  isActive: boolean;
}
