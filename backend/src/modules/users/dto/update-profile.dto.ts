import { IsEmail, IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { MaxByteLength } from '../../../common/validators/max-byte-length';

export class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @IsOptional()
  firstName?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  @IsOptional()
  lastName?: string;

  @IsString()
  @MaxLength(30)
  @IsOptional()
  phone?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @IsString()
  @MinLength(12)
  @MaxByteLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least 12 characters, one uppercase, one lowercase, one number, and one special character',
  })
  newPassword: string;

  @IsString()
  @MinLength(12)
  confirmPassword: string;
}

export class UpdateEmailDto {
  @IsEmail()
  email: string;
}

export class UpdateAvatarDto {
  @IsString()
  @IsOptional()
  avatarUrl?: string;
}
