import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class CreateFuelLogDto {
  @IsNumber()
  @Min(0)
  liters: number;

  @IsNumber()
  @Min(0)
  kilometers: number;

  @IsNumber()
  @Min(0)
  cost: number;

  @IsString()
  fillDate: string;

  @IsString()
  vehicleId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
