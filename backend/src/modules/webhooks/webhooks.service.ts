import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

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
      // `secret` local (en clair), pas `webhook.secret` : `create` n'est pas une
      // action de LECTURE pour le middleware de chiffrement (prisma-encryption
      // .middleware.ts ne déchiffre que find*), donc `webhook.secret` renvoyé
      // par le create() est le texte CHIFFRÉ, pas le secret réel.
      secret,
      url: webhook.url,
      events: webhook.events as string[],
      isActive: webhook.isActive,
    };
  }

  // `select` explicite (jamais `include` seul) : le contrat dit que `secret`
  // n'est renvoyé qu'UNE fois, à la création. Un `include` sans `select`
  // remontait `secret` (le secret de signature HMAC) sur chaque GET.
  private static readonly PUBLIC_FIELDS = {
    id: true,
    url: true,
    events: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async findAll(companyId: string) {
    return this.prisma.webhook.findMany({
      where: { companyId },
      select: {
        ...WebhooksService.PUBLIC_FIELDS,
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
      select: {
        ...WebhooksService.PUBLIC_FIELDS,
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

  async dispatch(
    event: string,
    companyId: string,
    payload: Record<string, unknown> | Prisma.JsonObject,
  ) {
    let webhooks: { id: string }[] = [];
    try {
      // SCOPING TENANT : un événement de livraison ne doit être notifié qu'aux
      // webhooks de LA MÊME entreprise. AVANT, dispatch() sélectionnait tous les
      // webhooks actifs abonnés à l'événement SANS filtre companyId → les données
      // d'une livraison (adresses, chauffeur, titre) partaient vers les URLs
      // configurées par TOUTES les autres entreprises de la plateforme (fuite
      // cross-tenant — le middleware tenant ne couvre pas ce service appelé hors
      // contexte HTTP).
      webhooks = await this.prisma.webhook.findMany({
        where: {
          companyId,
          isActive: true,
          events: { array_contains: event },
        },
        select: { id: true },
      });
    } catch (err: any) {
      // Une erreur de lecture des webhooks ne doit JAMAIS faire échouer l'opération
      // métier qui a déclenché l'événement (ex. transition de livraison déjà committée).
      return;
    }

    // Fire-and-forget : chaque livraison est lancée sans attendre (Promise.allSettled,
    // pas de rejet propagé). AVANT, dispatch() était `await`ée par l'appelant — une
    // webhook lente (jusqu'à 10 s de timeout) bloquait la réponse HTTP de la transition
    // de livraison, et une erreur (ex. webhookDelivery.create) faisait échouer le statut.
    // Le résultat de chaque tentative est PERSISTÉ (webhookDelivery) : le retry
    // (WebhookRetryProcessor, cron 5 min) relance les échecs avec backoff.
    void Promise.allSettled(
      webhooks.map((webhook) =>
        this.deliver(webhook.id, event, {
          event,
          timestamp: new Date().toISOString(),
          data: payload,
        }),
      ),
    );
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
}
