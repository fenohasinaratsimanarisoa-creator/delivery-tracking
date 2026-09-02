import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { MaxByteLength } from '../../../common/validators/max-byte-length';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  // Validation volontairement permissive (pas de politique de complexité) : un
  // compte créé avec un ancien mot de passe doit toujours pouvoir se connecter.
  // Le cap à 72 octets s'aligne sur la limite dure de bcrypt (au-delà, les
  // octets sont ignorés — autant refuser explicitement) et sur RegisterDto.
  @IsString()
  @MaxByteLength(72)
  password: string;

  // « Se souvenir de moi » : quand false/absent, le cookie de refresh est un
  // cookie de session (supprimé à la fermeture du navigateur) au lieu de
  // persister 7 jours. Voir AuthController.login.
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}
