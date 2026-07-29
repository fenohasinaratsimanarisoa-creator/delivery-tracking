import { Injectable, NotFoundException, BadRequestException, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import { assertSafeWebhookUrl } from './webhook-url-validator';
import * as crypto from 'crypto';

function generateSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

function signPayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly LOCK_KEY = 'webhook:retry:lock';
  private readonly LOCK_TTL = 240;

  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {}

  async create(companyId: string, dto: CreateWebhookDto) {
    await assertSafeWebhookUrl(dto.url);
    const secret = dto.secret || generateSecret();

    const webhook = await this.prisma.webhook.create({
      data: {
        companyId,
        url: dto.url,
        secret,
        events: dto.events,
      },
    });

    return {
      id: webhook.id,
      secret: webhook.secret,
      url: webhook.url,
      events: webhook.events as string[],
      isActive: webhook.isActive,
    };
  }

  async findAll(companyId: string) {
    return this.prisma.webhook.findMany({
      where: { companyId },
      include: {
        deliveries: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            event: true,
            status: true,
            responseStatusCode: true,
            attempts: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({
      where: { id, companyId },
      include: {
        deliveries: {
          take: 20,
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!webhook) throw new NotFoundException('Webhook not found');
    return webhook;
  }

  async update(companyId: string, id: string, dto: UpdateWebhookDto) {
    const existing = await this.prisma.webhook.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Webhook not found');

    const data: Record<string, unknown> = {};
    if (dto.url !== undefined) {
      await assertSafeWebhookUrl(dto.url);
      data.url = dto.url;
    }
    if (dto.events !== undefined) data.events = dto.events;
    if (dto.secret !== undefined) data.secret = dto.secret;

    return this.prisma.webhook.update({
      where: { id },
      data,
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(companyId: string, id: string) {
    const existing = await this.prisma.webhook.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Webhook not found');
    await this.prisma.webhook.delete({ where: { id } });
  }

  async toggle(companyId: string, id: string) {
    const existing = await this.prisma.webhook.findFirst({ where: { id, companyId } });
    if (!existing) throw new NotFoundException('Webhook not found');
    return this.prisma.webhook.update({
      where: { id },
      data: { isActive: !existing.isActive },
      select: { id: true, isActive: true },
    });
  }

  async sendTest(companyId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id, companyId } });
    if (!webhook) throw new NotFoundException('Webhook not found');

    const payload = {
      event: 'test.ping',
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from DeliveryTrack' },
    };

    return this.deliver(webhook.id, 'test.ping', payload);
  }

  async dispatch(event: string, payload: Record<string, unknown> | Prisma.JsonObject) {
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        isActive: true,
        events: { array_contains: event },
      },
    });

    for (const webhook of webhooks) {
      await this.deliver(webhook.id, event, {
        event,
        timestamp: new Date().toISOString(),
        data: payload,
      });
    }
  }

  private async deliver(
    webhookId: string,
    event: string,
    payload: Record<string, unknown> | Prisma.JsonObject,
  ) {
    const webhook = await this.prisma.webhook.findUnique({
      where: { id: webhookId },
    });
    if (!webhook) return;

    try {
      await assertSafeWebhookUrl(webhook.url);
    } catch {
      return;
    }

    const body = JSON.stringify(payload);
    const signature = signPayload(body, webhook.secret);

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let successful = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-DeliveryTrack-Signature-256': signature,
          'X-DeliveryTrack-Event': event,
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

    const attempts = successful ? 1 : 1;
    const maxAttempts = 5;
    const remaining = maxAttempts - attempts;
    const nextRetryAt =
      !successful && remaining > 0 ? new Date(Date.now() + Math.pow(2, attempts) * 60000) : null;

    await this.prisma.webhookDelivery.create({
      data: {
        webhookId,
        event,
        payload: payload as unknown as Prisma.JsonObject,
        status: successful ? 'success' : 'failed',
        responseStatusCode: statusCode,
        responseBody,
        attempts,
        maxAttempts,
        nextRetryAt,
      },
    });

    return { status: successful ? 'success' : 'failed', statusCode };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedDeliveries() {
    if (this.redis) {
      const acquired = (await this.redis.call('SET', this.LOCK_KEY, '1', 'NX', 'EX', String(this.LOCK_TTL))) as string | null;
      if (!acquired) {
        this.logger.debug('Distributed lock not acquired — skipping retry cycle');
        return;
      }
    }

    try {
      await this.doRetryFailedDeliveries();
    } finally {
      if (this.redis) {
        await this.redis.del(this.LOCK_KEY).catch(() => {});
      }
    }
  }

  private async doRetryFailedDeliveries() {
    const now = new Date();

    const failedDeliveries = await this.prisma.webhookDelivery.findMany({
      where: {
        status: 'failed',
        nextRetryAt: { lte: now },
        attempts: { lt: 5 },
      },
      include: { webhook: true },
    });

    for (const delivery of failedDeliveries) {
      try {
        await assertSafeWebhookUrl(delivery.webhook.url);
      } catch {
        continue;
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
        !successful && remaining > 0
          ? new Date(Date.now() + Math.pow(2, newAttempts) * 60000)
          : null;

      await this.prisma.webhookDelivery.update({
        where: { id: delivery.id },
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
  }
}
