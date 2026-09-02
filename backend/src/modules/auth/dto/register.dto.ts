import { IsEmail, IsOptional, IsString, IsNotEmpty } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password';

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  companyName: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsStrongPassword()
  password: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
