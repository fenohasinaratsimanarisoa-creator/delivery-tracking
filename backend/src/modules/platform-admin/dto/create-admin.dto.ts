import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password';

export class CreateAdminDto {
  @IsEmail()
  email: string;

  // Le compte platform-admin est le plus privilégié de la plateforme
  // (impersonation de n'importe quel tenant, accès à toutes les données) :
  // il DOIT respecter au minimum la même politique que les utilisateurs.
  @IsStrongPassword()
  password: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;
}
