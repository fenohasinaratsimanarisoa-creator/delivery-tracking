import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsIn,
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
  @IsNumber()
  @Min(0)
  @Max(100)
  theoreticalConsumption?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['phone', 'physical_tracker'])
  positionSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  traccarDeviceId?: string;
}
