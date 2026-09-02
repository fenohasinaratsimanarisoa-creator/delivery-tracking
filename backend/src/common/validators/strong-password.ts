import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Politique de mot de passe UNIQUE de la plateforme — appliquée partout où un
 * mot de passe est *choisi* (inscription, reset, création/changement d'un compte
 * platform-admin). Avant, seuls RegisterDto/ResetPasswordDto la portaient, en
 * copiant la regex ; les comptes platform-admin (les plus privilégiés) se
 * contentaient de `@MinLength(6)` sans exigence de complexité.
 *
 * NB : à n'utiliser QUE sur les DTO de *définition* de mot de passe. Les DTO de
 * *login* gardent une validation permissive (`@IsString`), sinon un compte
 * existant avec un ancien mot de passe plus court ne pourrait plus se connecter.
 *
 * Règles : 12–72 caractères (72 = limite dure de bcrypt, au-delà les octets
 * sont ignorés silencieusement — on la vérifie en OCTETS), au moins une
 * minuscule, une majuscule, un chiffre et un caractère spécial.
 */
export const PASSWORD_POLICY_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;

export const PASSWORD_POLICY_MESSAGE =
  'Password must contain at least 12 characters, one uppercase, one lowercase, one digit and one special character';

export function isStrongPassword(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (Buffer.byteLength(value, 'utf8') > 72) return false;
  return PASSWORD_POLICY_REGEX.test(value);
}

export function IsStrongPassword(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isStrongPassword(value);
        },
        defaultMessage(_args: ValidationArguments): string {
          return PASSWORD_POLICY_MESSAGE;
        },
      },
    });
  };
}
