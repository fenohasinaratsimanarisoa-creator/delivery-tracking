import { Injectable, Logger } from '@nestjs/common';

interface AlertPayload {
  title: string;
  message: string;
  level: 'info' | 'warning' | 'error' | 'critical';
  metadata?: Record<string, unknown>;
}

interface RateLimitEntry {
  count: number;
  firstSeen: number;
  lastSeen: number;
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly errorRateMap = new Map<string, RateLimitEntry>();
  private readonly RATE_WINDOW_MS = 5 * 60 * 1000; // 5 min
  private readonly RATE_THRESHOLD = 10; // 10 errors in window = alert

  /**
   * Track repeated errors and trigger an alert when a threshold is exceeded
   * within the configured time window. Prevents silent error loops like the
   * UUID crash that repeated every ~5s for hours undetected.
   *
   * The errorKey should uniquely identify the error type (e.g. method name).
   */
  async trackRepeatedError(
    errorKey: string,
    error: Error,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const now = Date.now();
    const entry = this.errorRateMap.get(errorKey);

    if (!entry || now - entry.firstSeen > this.RATE_WINDOW_MS) {
      this.errorRateMap.set(errorKey, { count: 1, firstSeen: now, lastSeen: now });
      return;
    }

    entry.count++;
    entry.lastSeen = now;

    if (entry.count === this.RATE_THRESHOLD) {
      const durationSec = Math.round((now - entry.firstSeen) / 1000);
      await this.send({
        title: `Repeated Error — ${errorKey}`,
        message: `${error.name}: ${error.message.substring(0, 200)} ` +
          `— repeated ${entry.count} times in ${durationSec}s`,
        level: 'critical',
        metadata: {
          errorKey,
          repeatCount: entry.count,
          durationSeconds: durationSec,
          intervalSeconds: Math.round(durationSec / entry.count),
          ...context,
        },
      });
    }

    if (entry.count > this.RATE_THRESHOLD) {
      this.errorRateMap.set(errorKey, { count: 1, firstSeen: now, lastSeen: now });
    }
  }

  async send(payload: AlertPayload): Promise<void> {
    this.logger.warn(
      `[ALERT] ${payload.level.toUpperCase()}: ${payload.title} — ${payload.message}`,
    );

    const webhookUrl = process.env.ALERT_SLACK_WEBHOOK || process.env.ALERT_DISCORD_WEBHOOK;
    if (!webhookUrl) return;

    const isDiscord = webhookUrl.includes('discord');

    try {
      if (isDiscord) {
        await this.sendDiscord(webhookUrl, payload);
      } else {
        await this.sendSlack(webhookUrl, payload);
      }
    } catch (err) {
      this.logger.error(`Failed to send alert: ${(err as Error).message}`);
    }
  }

  async sendCriticalError(error: Error, context?: Record<string, unknown>): Promise<void> {
    await this.send({
      title: 'Critical Error',
      message: `${error.name}: ${error.message}`,
      level: 'critical',
      metadata: {
        stack: error.stack?.split('\n').slice(0, 6).join('\n'),
        ...context,
      },
    });
  }

  async sendQueueStuck(queueName: string, failedCount: number): Promise<void> {
    await this.send({
      title: `BullMQ Queue Stuck — ${queueName}`,
      message: `Queue "${queueName}" has ${failedCount} failed jobs requiring attention.`,
      level: 'warning',
      metadata: { queue: queueName, failedCount },
    });
  }

  private async sendSlack(webhookUrl: string, payload: AlertPayload) {
    const colors: Record<string, string> = {
      info: '#3498db',
      warning: '#f39c12',
      error: '#e74c3c',
      critical: '#ff0000',
    };

    const body = {
      attachments: [
        {
          color: colors[payload.level] || '#cccccc',
          title: payload.title,
          text: payload.message,
          fields: payload.metadata
            ? Object.entries(payload.metadata).map(([k, v]) => ({
                title: k,
                value: String(v),
                short: true,
              }))
            : [],
          footer: `Delivery Tracking • ${process.env.NODE_ENV || 'development'}`,
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async sendDiscord(webhookUrl: string, payload: AlertPayload) {
    const colors: Record<string, number> = {
      info: 0x3498db,
      warning: 0xf39c12,
      error: 0xe74c3c,
      critical: 0xff0000,
    };

    const body = {
      embeds: [
        {
          title: payload.title,
          description: payload.message,
          color: colors[payload.level] || 0xcccccc,
          fields: payload.metadata
            ? Object.entries(payload.metadata).map(([k, v]) => ({
                name: k,
                value: String(v).substring(0, 1024),
                inline: true,
              }))
            : [],
          footer: { text: `Delivery Tracking • ${process.env.NODE_ENV || 'development'}` },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}
