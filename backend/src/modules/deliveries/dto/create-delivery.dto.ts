import { IsString, IsOptional, IsDateString, IsEnum, MinLength } from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

export class CreateDeliveryDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(DeliveryStatus)
  status?: DeliveryStatus;

  @IsString()
  @MinLength(1)
  pickupAddress: string;

  @IsOptional()
  pickupLat?: number;

  @IsOptional()
  pickupLng?: number;

  @IsOptional()
  @IsString()
  pickupLocationLabel?: string;

  @IsString()
  @MinLength(1)
  deliveryAddress: string;

  @IsOptional()
  deliveryLat?: number;

  @IsOptional()
  deliveryLng?: number;

  @IsOptional()
  @IsString()
  deliveryLocationLabel?: string;

  @IsOptional()
  @IsDateString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  vehicleId?: string;

  @IsOptional()
  @IsString()
  driverId?: string;
}
