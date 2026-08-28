import {
  IsString,
  IsOptional,
  IsDateString,
  IsEnum,
  MinLength,
  IsNumber,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
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
  @IsNumber()
  @IsLatitude()
  pickupLat?: number;

  @IsOptional()
  @IsNumber()
  @IsLongitude()
  pickupLng?: number;

  @IsOptional()
  @IsString()
  pickupLocationLabel?: string;

  @IsString()
  @MinLength(1)
  deliveryAddress: string;

  @IsOptional()
  @IsNumber()
  @IsLatitude()
  deliveryLat?: number;

  @IsOptional()
  @IsNumber()
  @IsLongitude()
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
