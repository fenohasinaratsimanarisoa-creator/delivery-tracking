import { IsString, IsNotEmpty, IsOptional, MinLength, MaxLength, Matches } from 'class-validator';
import { MaxByteLength } from '../../../common/validators/max-byte-length';

// Même politique que RegisterDto (password) : cette route crée un compte tout
// comme /auth/register, elle ne doit pas être un trou dans la politique
// commune (avant : body typé en interface TS inline, jamais validé par le
// ValidationPipe global — n'importe quel mot de passe, même vide, passait).
export class AcceptInvitationDto {
  @IsString()
  @MinLength(12)
  @MaxByteLength(72)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/, {
    message:
      'Password must contain at least 12 characters, one uppercase, one lowercase, one digit and one special character',
  })
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;
}
