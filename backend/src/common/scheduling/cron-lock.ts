import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';

const logger = new Logger('CronLock');

// Identité de ce process (host + UUID) — même principe que l'élection de leader
// du pont Traccar (traccar-bridge.service.ts).
const INSTANCE_ID = `${process.env.HOSTNAME || 'unknown'}-${randomUUID()}`;

/**
 * Verrou distribué best-effort pour une tâche planifiée (@Cron).
 *
 * POURQUOI : `ScheduleModule.forRoot()` est chargé par AppModule (process API)
 * ET QueueWorkerModule (process worker), et le service `backend` de
 * docker-compose.contabo.yml a `replicas: ${BACKEND_REPLICAS:-1}`. Sans verrou,
 * chaque cron (expiration d'abonnement, digests, purge d'entreprise, nettoyage
 * de notifications, rapports carburant quotidiens, relance de webhooks)
 * s'exécuterait sur CHAQUE instance : doubles emails, doubles purges, courses.
 *
 * Le verrou n'est jamais relâché explicitement : il expire au bout de
 * `ttlSeconds` (à choisir nettement < l'intervalle du cron), ce qui évite aussi
 * qu'un redémarrage juste après un crash relance la tâche dans la foulée.
 *
 * Sans Redis (redis null/undefined) OU en cas d'erreur Redis : retourne `true`
 * (exécution en mode mono-instance de repli — cohérent avec le reste du code
 * qui dégrade silencieusement sans Redis ; un cron sauté serait pire qu'un cron
 * dupliqué pour la facturation et les rapports).
 *
 * @returns true si CE process doit exécuter la tâche, false s'il doit passer.
 */
export async function acquireCronLock(
  redis: Redis | null | undefined,
  name: string,
  ttlSeconds: number,
): Promise<boolean> {
  if (!redis) return true;
  try {
    const res = await redis.set(`cron:lock:${name}`, INSTANCE_ID, 'EX', ttlSeconds, 'NX');
    if (res === 'OK') return true;
    logger.debug(`"${name}" held by another instance — skipping this run`);
    return false;
  } catch (err) {
    logger.warn(
      `Redis error acquiring cron lock "${name}" — running without lock: ${(err as Error).message}`,
    );
    return true;
  }
}
