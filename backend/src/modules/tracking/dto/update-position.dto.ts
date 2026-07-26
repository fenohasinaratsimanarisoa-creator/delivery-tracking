import { IsNumber, Min, Max, IsDateString, IsString, IsOptional, IsArray, IsUUID } from 'class-validator';

export class UpdatePositionDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  heading?: number;

  @IsOptional()
  @IsNumber()
  altitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;

  @IsDateString()
  timestamp: string;

  @IsOptional()
  @IsUUID('4')
  deliveryId?: string;

  @IsUUID('4')
  vehicleId: string;
}

export class BatchPositionDto {
  @IsArray()
  positions: UpdatePositionDto[];
}
