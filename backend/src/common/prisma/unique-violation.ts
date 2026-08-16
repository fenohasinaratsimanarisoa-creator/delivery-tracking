import { Prisma } from '@prisma/client';

/**
 * Détecte une violation de contrainte unique Prisma (code P2002) : la position
 * (vehicleId, timestamp) existe déjà en base. La contrainte unique composite sur
 * gps_positions est le filet anti-doublon de DERNIER recours — la course
 * backfill/position live est d'abord sérialisée PAR DEVICE (mutex en mémoire du
 * pont Traccar), mais une violation peut encore survenir en environnement
 * multi-réplica ou après un redémarrage (clé Redis perdue). Une P2002 doit être
 * traitée comme « position déjà présente » (log debug, jamais d'erreur remontée
 * à l'appelant).
 */
export function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
