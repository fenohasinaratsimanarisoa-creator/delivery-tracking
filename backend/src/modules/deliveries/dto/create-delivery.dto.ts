import { IsString, IsOptional, IsDateString, MinLength } from 'class-validator';

export class CreateDeliveryDto {
  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(1)
  pickupAddress: string;

  @IsOptional()
  pickupLat?: number;

  @IsOptional()
  pickupLng?: number;

  @IsString()
  @MinLength(1)
  deliveryAddress: string;

  @IsOptional()
  deliveryLat?: number;

  @IsOptional()
  deliveryLng?: number;

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
