import { IsNumber, Min, Max, IsDateString, IsOptional, IsArray, IsUUID } from 'class-validator';

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
  @Max(360)
  heading?: number;

  @IsOptional()
  @IsNumber()
  altitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000) // 1000m = seuil maximal d'une précision GPS exploitable ; au-delà c'est un fix invalide
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
