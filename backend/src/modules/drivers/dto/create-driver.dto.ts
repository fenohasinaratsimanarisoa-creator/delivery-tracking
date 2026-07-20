import { IsString, IsOptional, IsEmail, MinLength } from 'class-validator';

export class CreateDriverDto {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(1)
  licenseNumber: string;
}
