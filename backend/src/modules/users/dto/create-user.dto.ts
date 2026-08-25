import { IsEmail, IsEnum, IsOptional, IsString, MinLength, Matches } from 'class-validator';
import { UserRole } from '@prisma/client';
import { MaxByteLength } from '../../../common/validators/max-byte-length';

export class CreateUserDto {
  @IsEmail()
  email: string;

  // Même politique que RegisterDto : un compte posé par un admin ne doit pas
  // être plus faible qu'un compte auto-inscrit (avant : 8 caractères, aucune
  // complexité requise).
  @IsString()
  @MinLength(12)
  @MaxByteLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/, {
    message:
      'Password must contain at least 12 characters, one uppercase, one lowercase, one digit and one special character',
  })
  password: string;

  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(UserRole)
  role: UserRole;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsString()
  @IsOptional()
  vehicleId?: string;
}
