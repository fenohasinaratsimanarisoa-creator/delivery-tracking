import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * FAIBLESSE CORRIGÉE (audit GPS 2026-08-27, MOYENNE) : `@IsDateString()` seul
 * vérifie uniquement le FORMAT — n'importe quelle date ISO valide passe,
 * y compris 1970 ou 2099. Le timestamp ici est celui de l'ACQUISITION GPS
 * (déclaré par le client natif/JS), pas l'heure de réception serveur : une
 * horloge appareil mal réglée (fréquent sur les appareils bas de gamme sans
 * NTP fiable après un redémarrage) ou une valeur corrompue en file locale
 * SQLite peut produire un timestamp aberrant. Une fois en base, ce genre de
 * valeur fausse durablement les calculs dérivés d'un écart entre deux
 * positions consécutives (vitesse, ETA, détection de téléportation — voir
 * teleportation.utils, qui suppose des timestamps plausibles en entrée).
 *
 * Fenêtre volontairement large : le futur toléré couvre la dérive d'horloge
 * réaliste (pas la précision GPS elle-même, gérée ailleurs) ; le passé toléré
 * couvre un rattrapage de file locale après une coupure réseau prolongée
 * (voir PositionUploadWorker.MAX_BATCHES_PER_RUN, drainage par lots).
 */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000; // 5 min
const PAST_TOLERANCE_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export function IsPlausibleTimestamp(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isPlausibleTimestamp',
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
          return `${args.property} is outside the plausible acquisition window (device clock or corrupted local queue)`;
        },
      },
    });
  };
}
