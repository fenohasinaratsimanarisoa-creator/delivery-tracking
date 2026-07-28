import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { NotificationType, NotificationPriority } from '@prisma/client';

// Sentinel UUID for platform-level notifications (no specific company)
const PLATFORM_COMPANY_ID = '00000000-0000-0000-0000-000000000000';
const PLATFORM_ADMIN_USER_ID = '00000000-0000-4000-0000-000000000010';

interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  altitude: number;
  accuracy: number;
  fixTime: string;
  deviceTime: string;
  attributes?: Record<string, unknown>;
}

const BACKFILL_MAX_HOURS = 24;
const BATCH_INTERVAL_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 120000;
const INITIAL_RECONNECT_DELAY_MS = 2000;
const PENDING_POSITIONS_LIMIT = 1000;
const PENDING_POSITIONS_RETENTION_MS = 3600000;
const SILENT_DEVICE_CHECK_INTERVAL_MS = 60000;
const TRACCAR_HEALTH_CHECK_INTERVAL_MS = 300000;
const NEVER_CONNECTED_GRACE_PERIOD_MS = 30 * 60 * 1000;

@Injectable()
export class TraccarBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TraccarBridgeService.name);
  private socket: any = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setInterval> | null = null;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private neverConnectedTimer: ReturnType<typeof setInterval> | null = null;
  private readonly traccarUrl: string;
  private readonly traccarUser: string;
  private readonly traccarPassword: string;
  private connected = false;
  private sessionCookie: string | null = null;
  private reconnectAttempts = 0;
  private lastPositionReceivedAt: number | null = null;
  private sessionExpiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private trackingService: TrackingService,
    private trackingGateway: TrackingGateway,
    private notifications: NotificationsService,
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {
    this.traccarUrl = this.configService.get<string>('TRACCAR_URL', 'http://traccar:8082');
    this.traccarUser = this.configService.get<string>('TRACCAR_USER', 'admin');
    this.traccarPassword = this.configService.get<string>('TRACCAR_PASSWORD', 'admin');

    if (this.traccarUser === 'admin' && this.traccarPassword === 'admin') {
      this.logger.warn('TRACCAR_USER/TRACCAR_PASSWORD not configured — using default credentials, change in production');
    }
  }

  private disconnectStartTime: number | null = null;
  private disconnectionMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private inactiveNotified = false;

  async onModuleInit() {
    if (this.traccarUrl === 'http://traccar:8082' || this.traccarUrl === 'disabled') {
      this.logger.warn('Traccar bridge: TRACCAR_URL not configured — bridge inactive');
      await this.notifyInactiveOnce();
      return;
    }

    const nodeEnv = process.env.NODE_ENV || 'development';
    if (nodeEnv === 'production' && (this.traccarUser === 'admin' || this.traccarPassword === 'admin')) {
      throw new Error(
        'TRACCAR_USER/TRACCAR_PASSWORD doivent être configurés en production quand TRACCAR_URL est actif',
      );
    }

    this.startSilentDeviceCheck();
    this.startHealthCheck();
    this.startNeverConnectedCheck();
    this.startDisconnectionMonitor();
    await this.connect();
  }

  private async notifyInactiveOnce(): Promise<void> {
    if (this.inactiveNotified) return;
    this.inactiveNotified = true;
    try {
      await this.notifications.create(PLATFORM_COMPANY_ID, {
        type: NotificationType.system,
        priority: NotificationPriority.high,
        title: 'Pont Traccar non configuré',
        message: 'TRACCAR_URL n\'est pas défini — le pont Traccar est inactif. Les traceurs GPS physiques ne transmettront aucune position. Configurez TRACCAR_URL, TRACCAR_USER et TRACCAR_PASSWORD dans render.yaml ou le Dashboard Render.',
      });
    } catch {}
  }

  private startDisconnectionMonitor() {
    this.disconnectionMonitorTimer = setInterval(async () => {
      if (!this.connected && this.disconnectStartTime) {
        const elapsedMin = (Date.now() - this.disconnectStartTime) / 60000;
        if (elapsedMin > 15) {
          try {
            await this.notifications.create(PLATFORM_COMPANY_ID, {
              type: NotificationType.system,
              priority: NotificationPriority.critical,
              title: 'Pont Traccar hors ligne prolongé',
              message: `Le pont Traccar est déconnecté depuis ${Math.round(elapsedMin)} minutes (${this.reconnectAttempts} tentatives)`,
            });
          } catch {}
        }
      }
    }, 60000);
  }

  onModuleDestroy() {
    this.disconnect();
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.neverConnectedTimer) clearInterval(this.neverConnectedTimer);
    if (this.disconnectionMonitorTimer) clearInterval(this.disconnectionMonitorTimer);
  }

  getStatus() {
    return {
      connected: this.connected,
      lastPositionReceivedAt: this.lastPositionReceivedAt,
      reconnectAttempts: this.reconnectAttempts,
      hasSession: !!this.sessionCookie,
    };
  }

  private startHealthCheck() {
    this.healthTimer = setInterval(async () => {
      try {
        if (!this.sessionCookie) {
          this.logger.warn('Traccar health check: no session — Traccar may be unreachable');
          return;
        }
        const response = await fetch(`${this.traccarUrl}/api/server`, {
          headers: { Cookie: this.sessionCookie },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          this.logger.warn(`Traccar health check failed: HTTP ${response.status}`);
        }
      } catch (err: any) {
        this.logger.warn(`Traccar health check: Traccar serveur injoignable — ${err.message}`);
      }
    }, TRACCAR_HEALTH_CHECK_INTERVAL_MS);
  }

  private async checkNeverConnectedDevices() {
    try {
      const vehiclesWithTrackers = await this.prisma.vehicle.findMany({
          where: {
            positionSource: 'physical_tracker',
            isActive: true,
            deletedAt: null,
            driver: { isActive: true, deletedAt: null },
          },
          select: {
            id: true,
            companyId: true,
            createdAt: true,
            traccarDeviceId: true,
            driver: { select: { id: true, userId: true } },
          },
        });

        for (const vehicle of vehiclesWithTrackers) {
          if (!vehicle.driver?.userId) continue;
          if (!vehicle.traccarDeviceId) continue;

          const creationAgeMin = (Date.now() - vehicle.createdAt.getTime()) / 60000;

          if (creationAgeMin < NEVER_CONNECTED_GRACE_PERIOD_MS / 60000) continue;

          const lastPos = await this.trackingService.getLastPosition(vehicle.id);
          if (lastPos) continue;

          const cooldownKey = `never_connected_alert:${vehicle.id}`;
          if (this.redis) {
            const existing = await this.redis.get(cooldownKey);
            if (existing) continue;
            await this.redis.setex(cooldownKey, 86400, '1');
          }

          await this.notifications.create(vehicle.companyId, {
            type: NotificationType.device_offline,
            priority: NotificationPriority.high,
            title: 'Traceur physique : jamais connecté',
            message: `Le traceur "${vehicle.traccarDeviceId}" n'a encore jamais envoyé de position (créé il y a ${Math.round(creationAgeMin)} min). Vérifiez : (1) SIM active et APN correct, (2) protocole activé dans traccar.xml, (3) port ouvert sur le firewall, (4) device créé dans Traccar avec le bon IMEI.`,
            userId: vehicle.driver.userId,
          });
        }
    } catch (err: any) {
      this.logger.error(`Never-connected check error: ${err.message}`);
    }
  }

  private startNeverConnectedCheck() {
    this.neverConnectedTimer = setInterval(() => {
      this.checkNeverConnectedDevices();
    }, SILENT_DEVICE_CHECK_INTERVAL_MS);
  }

  private startSilentDeviceCheck() {
    this.silenceTimer = setInterval(() => {
      this.checkSilentPhysicalDevices().catch((err) =>
        this.logger.error(`Silent device check error: ${err.message}`),
      );
    }, SILENT_DEVICE_CHECK_INTERVAL_MS);
  }

  private async checkSilentPhysicalDevices() {
    const vehiclesWithTrackers = await this.prisma.vehicle.findMany({
      where: {
        positionSource: 'physical_tracker',
        isActive: true,
        deletedAt: null,
        driver: { isActive: true, deletedAt: null },
      },
      select: {
        id: true,
        companyId: true,
        driver: { select: { id: true, userId: true } },
      },
    });

    for (const vehicle of vehiclesWithTrackers) {
      if (!vehicle.driver?.userId) continue;

      const lastPos = await this.trackingService.getLastPosition(vehicle.id);
      if (!lastPos) continue;

      const settings = await this.trackingService.getCompanySettings(vehicle.companyId);
      const timeout = settings?.offlineTimeoutMinutes || 15;
      const elapsedMin = (Date.now() - lastPos.timestamp.getTime()) / 60000;

      if (elapsedMin > timeout) {
        const cooldownKey = `silent_alert:${vehicle.id}`;
        if (this.redis) {
          const existing = await this.redis.get(cooldownKey);
          if (existing) continue;
          await this.redis.setex(cooldownKey, Math.round(timeout * 60), '1');
        }

        await this.notifications.create(vehicle.companyId, {
          type: NotificationType.device_offline,
          priority: NotificationPriority.medium,
          title: 'Traceur physique hors ligne',
          message: `Le traceur GPS du véhicule n'a pas envoyé de position depuis ${Math.round(elapsedMin)} minutes`,
          userId: vehicle.driver.userId,
        });
      }
    }
  }

  private async authenticate(): Promise<string> {
    const loginResponse = await fetch(`${this.traccarUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(this.traccarUser)}&password=${encodeURIComponent(this.traccarPassword)}`,
    });

    if (!loginResponse.ok) {
      throw new Error(`Traccar authentication failed: HTTP ${loginResponse.status}`);
    }

    const setCookie = loginResponse.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('Traccar did not return a session cookie');
    }

    const match = setCookie.match(/JSESSIONID=([^;]+)/);
    if (!match) {
      throw new Error('Traccar session cookie (JSESSIONID) not found');
    }

    const cookie = `JSESSIONID=${match[1]}`;
    this.sessionCookie = cookie;
    this.logger.log('Traccar REST session established');

    this.scheduleSessionRenewal();
    return cookie;
  }

  private scheduleSessionRenewal() {
    if (this.sessionExpiryTimer) clearTimeout(this.sessionExpiryTimer);
    this.sessionExpiryTimer = setTimeout(
      () => {
        this.logger.log('Traccar session expiry timer triggered — reconnecting');
        this.disconnect();
        this.connect();
      },
      30 * 60 * 1000,
    );
  }

  private async connect() {
    try {
      const cookie = await this.authenticate();
      const WebSocket = (await import('ws')).default;
      const wsUrl = this.traccarUrl.replace(/^http/, 'ws') + '/api/socket';

      this.socket = new WebSocket(wsUrl, {
        headers: { Cookie: cookie },
        handshakeTimeout: 10000,
      });

      this.socket.on('open', () => {
        this.connected = true;
        this.disconnectStartTime = null;
        this.reconnectAttempts = 0;
        this.logger.log(`Traccar bridge connected to ${wsUrl}`);
        this.performBackfill();
      });

      this.socket.on('message', async (data: Buffer) => {
        try {
          const text = data.toString();
          if (text.startsWith('{')) {
            const msg = JSON.parse(text);
            if (msg.positions) {
              for (const pos of msg.positions) {
                await this.handlePosition(pos);
              }
            }
          }
        } catch (err: any) {
          this.logger.error(`Traccar message parse error: ${err.message}`);
        }
      });

      this.socket.on('close', async (code: number) => {
        this.connected = false;
        this.sessionCookie = null;
        if (!this.disconnectStartTime) this.disconnectStartTime = Date.now();
        this.logger.warn(`Traccar bridge disconnected (code ${code})`);
        this.scheduleReconnect();
      });

      this.socket.on('error', (err: Error) => {
        this.logger.error(`Traccar bridge socket error: ${err.message}`);
        this.socket?.close();
      });
    } catch (err: any) {
      this.logger.error(`Traccar bridge connection failed: ${err.message}`);
      this.connected = false;
      this.sessionCookie = null;
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1) + Math.random() * 1000,
      MAX_RECONNECT_DELAY_MS,
    );

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.backfillTimer) clearTimeout(this.backfillTimer);
    if (this.sessionExpiryTimer) clearTimeout(this.sessionExpiryTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.sessionCookie = null;
  }

  private async performBackfill() {
    if (!this.sessionCookie) return;

    try {
      const vehiclesWithTrackers = await this.prisma.vehicle.findMany({
        where: {
          traccarDeviceId: { not: null },
          positionSource: 'physical_tracker',
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          traccarDeviceId: true,
          companyId: true,
        },
      });

      if (vehiclesWithTrackers.length === 0) return;

      const now = new Date();

      for (const vehicle of vehiclesWithTrackers) {
        if (!vehicle.traccarDeviceId) continue;

        let lastTs: Date | null = null;
        if (this.redis) {
          const stored = await this.redis.get(`traccar:last_position:${vehicle.traccarDeviceId}`);
          if (stored) lastTs = new Date(stored);
        }

        if (!lastTs) {
          const lastPos = await this.trackingService.getLastPosition(vehicle.id);
          if (lastPos) lastTs = lastPos.timestamp;
        }

        const from = lastTs || new Date(now.getTime() - BACKFILL_MAX_HOURS * 3600000);

        const fromLimit = new Date(now.getTime() - BACKFILL_MAX_HOURS * 3600000);
        const effectiveFrom = from > fromLimit ? from : fromLimit;

        if (effectiveFrom >= now) continue;

        try {
          const url = `${this.traccarUrl}/api/positions?deviceId=${vehicle.traccarDeviceId}&from=${effectiveFrom.toISOString()}&to=${now.toISOString()}`;
          const response = await fetch(url, {
            headers: { Cookie: this.sessionCookie },
          });

          if (!response.ok) {
            this.logger.warn(`Backfill fetch failed for device ${vehicle.traccarDeviceId}: HTTP ${response.status}`);
            continue;
          }

          const positions: TraccarPosition[] = await response.json();
          if (positions.length === 0) continue;

          this.logger.log(`Backfill: ${positions.length} positions for device ${vehicle.traccarDeviceId}`);

          for (const pos of positions) {
            await this.handlePosition(pos);
          }
        } catch (err: any) {
          this.logger.warn(`Backfill error for device ${vehicle.traccarDeviceId}: ${err.message}`);
        }
      }
    } catch (err: any) {
      this.logger.error(`Backfill failed: ${err.message}`);
    }
  }

  private async handlePosition(pos: TraccarPosition) {
    try {
      const timestamp = this.parseTimestamp(pos);
      if (!this.isValidCoordinates(pos.latitude, pos.longitude)) {
        this.logger.warn(
          `Invalid coordinates from Traccar device ${pos.deviceId}: lat=${pos.latitude}, lng=${pos.longitude}`,
        );
        return;
      }

      const vehicleMapping = await this.prisma.vehicle.findFirst({
        where: {
          traccarDeviceId: String(pos.deviceId),
          positionSource: 'physical_tracker',
          isActive: true,
          deletedAt: null,
        },
        select: {
          id: true,
          companyId: true,
          driver: {
            select: {
              id: true,
              userId: true,
              user: { select: { firstName: true, lastName: true } },
            },
          },
        },
      });

      if (!vehicleMapping) return;

      const driver = vehicleMapping.driver;
      if (!driver?.userId) return;

      const driverUser = driver.user;
      const driverName = driverUser
        ? `${driverUser.firstName} ${driverUser.lastName}`
        : 'Traccar GPS';

      const currentDelivery = await this.prisma.delivery.findFirst({
        where: {
          driverId: driver.id,
          status: 'in_progress',
          deletedAt: null,
        },
        select: { id: true },
      });

      const updateDto = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed: (pos.speed || 0) * 0.514444,
        heading: pos.course || 0,
        altitude: pos.altitude || 0,
        accuracy: pos.accuracy || 10,
        timestamp: timestamp.toISOString(),
        vehicleId: vehicleMapping.id,
        deliveryId: currentDelivery?.id,
      };

      let position;
      try {
        position = await this.trackingService.savePosition(
          driver.id,
          updateDto as any,
          vehicleMapping.companyId,
        );

        if (this.redis) {
          await this.redis.set(
            `traccar:last_position:${pos.deviceId}`,
            timestamp.toISOString(),
          );
        }
      } catch (saveErr: any) {
        this.logger.error(`Save position failed for device ${pos.deviceId}: ${saveErr.message} — queueing`);
        await this.queuePendingPosition(pos);
        return;
      }

      if (position) {
        this.lastPositionReceivedAt = Date.now();
        this.trackingGateway.broadcastDataUpdate(vehicleMapping.companyId, 'position', {
          driverId: driver.id,
          latitude: pos.latitude,
          longitude: pos.longitude,
          timestamp: updateDto.timestamp,
        });

        const broadcast = {
          driverId: driver.id,
          driverName,
          latitude: pos.latitude,
          longitude: pos.longitude,
          speed: updateDto.speed,
          heading: updateDto.heading,
          altitude: updateDto.altitude,
          accuracy: updateDto.accuracy,
          suspect: position.suspect,
          confidence: updateDto.accuracy ? Math.max(0.1, 1 - updateDto.accuracy / 50) : 1,
          timestamp: updateDto.timestamp,
          deliveryId: updateDto.deliveryId ?? undefined,
          vehicleId: vehicleMapping.id,
        };

        this.trackingGateway.broadcastToCompany(vehicleMapping.companyId, 'positionUpdate', broadcast);
      }
    } catch (err: any) {
      this.logger.error(`Traccar position handling error: ${err.message}`);
    }
  }

  private parseTimestamp(pos: TraccarPosition): Date {
    const raw = pos.fixTime || pos.deviceTime;
    if (!raw) {
      this.logger.warn(`Traccar device ${pos.deviceId}: missing fixTime/deviceTime — using server time`);
      return new Date();
    }
    const date = new Date(raw);
    if (isNaN(date.getTime())) {
      this.logger.warn(`Traccar device ${pos.deviceId}: invalid timestamp "${raw}" — using server time`);
      return new Date();
    }
    return date;
  }

  private isValidCoordinates(lat: number, lng: number): boolean {
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false;
    return true;
  }

  private async queuePendingPosition(pos: TraccarPosition) {
    if (!this.redis) {
      this.logger.warn('Redis not available — cannot queue pending position');
      return;
    }

    try {
      const payload = JSON.stringify({
        ...pos,
        _queuedAt: Date.now(),
      });

      await this.redis.lpush('traccar:pending-positions', payload);
      await this.redis.ltrim('traccar:pending-positions', 0, PENDING_POSITIONS_LIMIT - 1);

      const count = await this.redis.llen('traccar:pending-positions');
      if (count === 1) {
        this.processPendingPositions();
      }
    } catch (err: any) {
      this.logger.error(`Failed to queue pending position: ${err.message}`);
    }
  }

  private async processPendingPositions() {
    if (!this.redis) return;

    try {
      const raw = await this.redis.lrange('traccar:pending-positions', 0, -1);
      if (raw.length === 0) return;

      const now = Date.now();
      const toRetry: string[] = [];
      const toPurge: string[] = [];

      for (const entry of raw) {
        const pos = JSON.parse(entry);
        if (now - (pos._queuedAt || 0) > PENDING_POSITIONS_RETENTION_MS) {
          toPurge.push(entry);
          this.logger.warn(`Purging stale pending position from device ${pos.deviceId} (queued >1h)`);
          continue;
        }
        toRetry.push(entry);
      }

      if (toPurge.length > 0) {
        for (const entry of toPurge) {
          await this.redis.lrem('traccar:pending-positions', 1, entry);
        }
      }

      let retried = 0;
      for (const entry of toRetry) {
        const pos = JSON.parse(entry);
        try {
          await this.handlePosition(pos);
          await this.redis.lrem('traccar:pending-positions', 1, entry);
          retried++;
        } catch {
          break;
        }
      }

      if (retried > 0) {
        this.logger.log(`Retried ${retried} pending positions from queue`);
      }

      const remaining = await this.redis.llen('traccar:pending-positions');
      if (remaining > 0) {
        setTimeout(() => this.processPendingPositions(), BATCH_INTERVAL_MS);
      }
    } catch (err: any) {
      this.logger.error(`Process pending positions error: ${err.message}`);
      setTimeout(() => this.processPendingPositions(), BATCH_INTERVAL_MS);
    }
  }
}
