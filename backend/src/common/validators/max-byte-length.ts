import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Vérifie qu'une chaîne ne dépasse pas `maxBytes` OCTETS (encodage UTF-8).
 *
 * Pourquoi pas `@MaxLength` de class-validator ? Il compte les caractères
 * (code points), pas les octets. bcrypt ne lit que les 72 PREMIERS OCTETS d'un
 * mot de passe : deux mots de passe différents partageant le même préfixe de
 * 72 octets seraient équivalents (et les caractères multi-octets comme `é`
 * aggravent l'écart caractères/octets). Cette contrainte plafonne donc la
 * taille au moment où le mot de passe est DÉFINI (register, reset, change,
 * création/modification par admin).
 */
export function MaxByteLength(maxBytes: number, validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'maxByteLength',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          if (typeof value !== 'string') return false;
          const limit = args.constraints[0] as number;
          return Buffer.byteLength(value, 'utf8') <= limit;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} must be at most ${args.constraints[0]} bytes (UTF-8)`;
        },
      },
    });
  };
}
