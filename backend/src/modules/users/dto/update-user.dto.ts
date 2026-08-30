import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
  Matches,
} from 'class-validator';
import { UserRole } from '@prisma/client';
import { MaxByteLength } from '../../../common/validators/max-byte-length';

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  // Même politique que RegisterDto / CreateUserDto : un mot de passe posé par
  // un admin via PATCH ne doit pas être plus faible qu'un mot de passe
  // auto-défini (avant : 8 caractères, aucune complexité requise).
  @IsString()
  @MinLength(12)
  @MaxByteLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/, {
    message:
      'Password must contain at least 12 characters, one uppercase, one lowercase, one digit and one special character',
  })
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsString()
  @IsOptional()
  vehicleId?: string;
}
