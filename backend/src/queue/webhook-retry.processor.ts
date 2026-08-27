import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, Inject, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import type Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import { acquireCronLock } from '../common/scheduling/cron-lock';
import { assertSafeWebhookUrl } from '../modules/webhooks/webhook-url-validator';

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

@Processor('webhook-retry', { concurrency: 1 })
export class WebhookRetryProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookRetryProcessor.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue('webhook-retry') private retryQueue: Queue,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null = null,
  ) {
    super();
  }

  async process(job: Job<{ webhookDeliveryId: string }>): Promise<void> {
    const { webhookDeliveryId } = job.data;
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: webhookDeliveryId },
      include: { webhook: { include: { company: { select: { deletedAt: true } } } } },
    });

    if (!delivery || delivery.status === 'success' || delivery.attempts >= delivery.maxAttempts)
      return;

    // GARDE-FOU TENANT : ne JAMAIS rejouer un webhook dont l'entreprise a été
    // supprimée (soft delete — deletedAt posé). Le soft delete ne déclenche PAS le
    // cascade Prisma (onDelete: Cascade ne s'applique qu'à un vrai DELETE), et la
    // purge (CompanyPurgeProcessor) n'efface pas les webhooks : sans ce garde-fou,
    // le retry continuerait de POSTer les données de livraison (adresses, chauffeur…)
    // d'une entreprise supprimée vers une URL externe jusqu'à épuisement des
    // tentatives. On stoppe la boucle : plus de rejeu, plus de prochaine tentative.
    if (delivery.webhook.company?.deletedAt) {
      this.logger.warn(
        `Webhook retry aborted: company of webhook ${delivery.webhookId} is deleted — no replay`,
      );
      await this.prisma.webhookDelivery.update({
        where: { id: webhookDeliveryId },
        data: { status: 'failed', nextRetryAt: null },
      });
      return;
    }

    try {
      await assertSafeWebhookUrl(delivery.webhook.url);
    } catch {
      await this.prisma.webhookDelivery.update({
        where: { id: webhookDeliveryId },
        data: { status: 'failed', nextRetryAt: null },
      });
      return;
    }

    const body = JSON.stringify(delivery.payload);
    const signature = signPayload(body, delivery.webhook.secret);

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let successful = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(delivery.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DeliveryTrack-Signature-256': signature,
          'X-DeliveryTrack-Event': delivery.event,
          'User-Agent': 'DeliveryTrack-Webhook/1.0',
        },
        body,
        signal: controller.signal,
        redirect: 'manual',
      });

      clearTimeout(timeout);
      statusCode = response.status;

      if (statusCode >= 300 && statusCode < 400) {
        statusCode = 422;
        responseBody = 'Webhook delivery does not follow redirects';
        successful = false;
      } else {
        responseBody = (await response.text()).slice(0, 5000);
        successful = statusCode >= 200 && statusCode < 300;
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      statusCode = e.name === 'AbortError' ? 408 : 0;
      responseBody = (e.message || 'Unknown error').slice(0, 5000);
    }

    const newAttempts = delivery.attempts + 1;
    const remaining = delivery.maxAttempts - newAttempts;
    const nextRetryAt =
      !successful && remaining > 0 ? new Date(Date.now() + Math.pow(2, newAttempts) * 60000) : null;

    await this.prisma.webhookDelivery.update({
      where: { id: webhookDeliveryId },
      data: {
        status: successful ? 'success' : 'failed',
        responseStatusCode: statusCode,
        responseBody,
        attempts: newAttempts,
        nextRetryAt,
        completedAt: successful ? new Date() : null,
      },
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async enqueueFailedDeliveries() {
    // Ce @Cron tourne dans le process API (QueueModule @Global) ET dans le
    // worker dédié, plus une fois par réplica API. Verrou distribué (TTL 240s <
    // 5 min) pour qu'une seule instance enfile les relances par cycle. Filet
    // supplémentaire : jobId déterministe côté add() → BullMQ dédoublonne même
    // si deux instances passent la fenêtre.
    if (!(await acquireCronLock(this.redis, 'webhook.enqueueFailedDeliveries', 240))) return;
    const now = new Date();
    // Limite de tentatives alignée sur maxAttempts de CHAQUE livraison (pas un 5 en dur) :
    // le process() du worker s'arrête à delivery.maxAttempts, la sélection du cron doit
    // faire pareil, sinon une livraison configurée avec maxAttempts différent serait
    // relancée indéfiniment (ou jamais jusqu'à épuisement si maxAttempts > 5).
    // SCOPING TENANT : les webhookDeliveries d'entreprises supprimées (deletedAt
    // posé) ne doivent jamais être rejouées — le garde-fou du process() couvre le
    // cas résiduel (job déjà en file), ce filtre évite même de les re-sélectionner.
    // Le soft delete ne cascade pas (les webhooks survivent à la suppression de
    // l'entreprise), la purge ne les efface pas : ce filtre est la première barrière.
    const failed = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'failed',
        nextRetryAt: { lte: now },
        webhook: { company: { deletedAt: null } },
      },
      select: { id: true, attempts: true, maxAttempts: true },
    });

    for (const delivery of failed) {
      if (delivery.attempts >= delivery.maxAttempts) continue;
      await this.retryQueue.add(
        'retry',
        { webhookDeliveryId: delivery.id },
        {
          // jobId déterministe (livraison + n° de tentative) : deux enqueues
          // concurrents produisent le MÊME jobId → BullMQ n'en garde qu'un.
          jobId: `retry:${delivery.id}:${delivery.attempts}`,
          attempts: 1,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      );
    }
  }
}
