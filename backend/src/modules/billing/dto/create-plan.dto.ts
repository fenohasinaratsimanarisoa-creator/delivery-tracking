import { IsString, IsNumber, IsOptional, IsArray, IsEnum, Min } from 'class-validator';
import { PlanTier } from '@prisma/client';

export class CreatePlanDto {
  @IsEnum(PlanTier)
  tier: PlanTier;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  interval?: string;

  @IsNumber()
  @Min(0)
  maxVehicles: number;

  @IsNumber()
  @Min(0)
  maxDeliveriesPerMonth: number;

  @IsNumber()
  @Min(0)
  maxUsers: number;

  @IsOptional()
  @IsArray()
  features?: string[];
}
