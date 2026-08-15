import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
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
  ) {
    super();
  }

  async process(job: Job<{ webhookDeliveryId: string }>): Promise<void> {
    const { webhookDeliveryId } = job.data;
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: webhookDeliveryId },
      include: { webhook: true },
    });

    if (!delivery || delivery.status === 'success' || delivery.attempts >= delivery.maxAttempts)
      return;

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
    const now = new Date();
    // Limite de tentatives alignée sur maxAttempts de CHAQUE livraison (pas un 5 en dur) :
    // le process() du worker s'arrête à delivery.maxAttempts, la sélection du cron doit
    // faire pareil, sinon une livraison configurée avec maxAttempts différent serait
    // relancée indéfiniment (ou jamais jusqu'à épuisement si maxAttempts > 5).
    const failed = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'failed',
        nextRetryAt: { lte: now },
      },
      select: { id: true, attempts: true, maxAttempts: true },
    });

    for (const delivery of failed) {
      if (delivery.attempts >= delivery.maxAttempts) continue;
      await this.retryQueue.add(
        'retry',
        { webhookDeliveryId: delivery.id },
        {
          attempts: 1,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 },
        },
      );
    }
  }
}
