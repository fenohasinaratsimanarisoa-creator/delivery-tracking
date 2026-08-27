import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * FAIBLESSE CORRIGÉE (audit carburant 2026-08-27, HAUTE) : `@IsDateString()`
 * seul vérifie uniquement le FORMAT — n'importe quelle date ISO valide passe,
 * y compris 1970 ou 2099. Même classe de bug que le timestamp GPS corrigé le
 * même jour (voir plausible-timestamp.ts), mais avec une fenêtre volontairement
 * BEAUCOUP plus large : un plein est saisi manuellement, souvent en différé
 * (import d'historique, oubli corrigé le lendemain, reçu papier ressaisi plus
 * tard) — contrairement à un fix GPS, qui est toujours "maintenant".
 *
 * Une date de plein aberrante fausse `prevLog` (recherche du plein
 * chronologiquement précédent), la fenêtre GPS associée au cross-check, et
 * tout calcul de consommation/historique qui en dérive.
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000; // 1 jour — dérive de fuseau horaire
const PAST_TOLERANCE_MS = 10 * 365 * 24 * 60 * 60 * 1000; // 10 ans — import d'historique légitime

export function IsPlausibleFuelDate(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPlausibleFuelDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          const ms = Date.parse(value);
          if (Number.isNaN(ms)) return false;
          const now = Date.now();
          return ms <= now + FUTURE_TOLERANCE_MS && ms >= now - PAST_TOLERANCE_MS;
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property} is outside the plausible range (not more than 1 day in the future, or more than 10 years in the past)`;
        },
      },
    });
  };
}
