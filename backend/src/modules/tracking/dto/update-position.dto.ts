import { IsNumber, Min, Max, IsDateString, IsString, IsOptional, IsArray } from 'class-validator';

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

  @IsDateString()
  timestamp: string;

  @IsString()
  deliveryId: string;

  @IsString()
  vehicleId: string;
}

export class BatchPositionDto {
  @IsArray()
  positions: UpdatePositionDto[];
}
