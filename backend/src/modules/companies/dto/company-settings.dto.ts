import { IsOptional, IsString, IsEmail, IsNumber, Min, Max } from 'class-validator';
import { FuelUnit } from '@prisma/client';

export class UpdateCompanySettingsDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  billingEmail?: string;

  @IsString()
  @IsOptional()
  billingAddress?: string;

  @IsString()
  @IsOptional()
  billingTaxId?: string;

  @IsString()
  @IsOptional()
  logoUrl?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;
}

export class UpdateCompanyFuelSettingsDto {
  @IsOptional()
  unit?: FuelUnit;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  anomalyThreshold?: number;
}

export class CompanySettingsResponseDto {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
  billingEmail?: string;
  billingAddress?: string;
  billingTaxId?: string;
  fuelAnomalyThreshold?: number;
  fuelUnit?: FuelUnit;
  fuelAnomalyThresholdSetting?: number;
  createdAt: Date;
  updatedAt: Date;
}
