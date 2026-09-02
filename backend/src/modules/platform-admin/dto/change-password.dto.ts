import { IsString, IsNotEmpty } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password';

export class PlatformAdminChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsStrongPassword()
  newPassword: string;
}
