import {
  IsString, IsInt, IsOptional, IsBoolean, Min, Max, MinLength, IsIn,
} from 'class-validator';

export class CreateVehicleDto {
  @IsString()
  @MinLength(1)
  brand: string;

  @IsString()
  @MinLength(1)
  model: string;

  @IsInt()
  @Min(1990)
  @Max(2030)
  year: number;

  @IsString()
  @MinLength(1)
  licensePlate: string;

  @IsString()
  @IsOptional()
  vin?: string;

  @IsString()
  fuelType: string;

  @IsOptional()
  theoreticalConsumption?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['phone', 'physical_tracker'])
  positionSource?: string;

  @IsOptional()
  @IsString()
  traccarDeviceId?: string;
}
