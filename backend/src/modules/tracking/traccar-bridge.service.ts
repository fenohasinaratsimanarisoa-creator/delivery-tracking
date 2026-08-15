import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingGateway } from '../tracking/tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertService } from '../../common/alerting/alert.service';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { UpdatePositionDto } from '../tracking/dto/update-position.dto';
import { haversineDistance } from '../../common/geo/geo.utils';
import { evaluateTeleportation } from '../../common/geo/teleportation.utils';

interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  speed: number;
  course: number;
  altitude: number;
  accuracy: number;
  valid: boolean;
  fixTime: string;
  deviceTime: string;
  attributes?: Record<string, unknown>;
}

// UERE pour récepteur GPS grand public : ~5m (combinaison erreurs satellite + atmosphère + récepteur)
// HDOP * UERE = accuracy estimée ; on prend la plus prudente (max) entre accuracy du device et HDOP dérivé
import { computeConfidence, computeCombinedAccuracy } from '../../common/geo/gps-quality';

const BACKFILL_MAX_HOURS = 24;
const BATCH_INTERVAL_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 120000;
const INITIAL_RECONNECT_DELAY_MS = 2000;
const PENDING_POSITIONS_LIMIT = 1000;
const PENDING_POSITIONS_RETENTION_MS = 3600000;
const SILENT_DEVICE_CHECK_INTERVAL_MS = 60000;
const TRACCAR_HEALTH_CHECK_INTERVAL_MS = 300000;
const NEVER_CONNECTED_GRACE_PERIOD_MS = 30 * 60 * 1000;
const LEADER_KEY = 'traccar:bridge:leader';
const LEADER_TTL_S = 30;
const LEADER_RENEW_INTERVAL_MS = 20000;
const LEADER_RETRY_INTERVAL_MS = 20000;

export interface TraccarDiagnoseDevice {
  id: number;
  name?: string;
  uniqueId?: string;
  status?: string;
  disabled?: boolean;
  lastUpdate?: string | null;
  protocol: string | null;
  protocolSource: 'device_champ' | 'device_attributes' | 'position_traccar' | null;
}

interface TraccarApiDevice {
  id: number;
  name?: string;
  uniqueId?: string;
  status?: string;
  disabled?: boolean;
  lastUpdate?: string | null;
  protocol?: unknown;
  attributes?: { protocol?: unknown };
}

interface TraccarApiPosition {
  deviceId?: number;
  protocol?: string;
}

export interface TraccarDiagnoseReport {
  timestamp: string;
  environment: string;
  config: {
    urlConfigured: boolean;
    userConfigured: boolean;
    passwordConfigured: boolean;
    urlIsDefault: boolean;
    fullyConfigured: boolean;
    note: string;
  };
  authentication: {
    attempted: boolean;
    success: boolean | null;
    httpStatus: number | null;
    error: string | null;
  };
  devices: {
    exposedByApi: boolean;
    success: boolean;
    httpStatus: number | null;
    error: string | null;
    count: number;
    protocolInferenceAvailable: boolean;
    protocolNote: string;
    items: TraccarDiagnoseDevice[];
  };
  protocolPort: {
    exposedByApi: boolean;
    message: string;
    reference: string;
  };
}

@Injectable()
export class TraccarBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TraccarBridgeService.name);
  // Identité UNIQUE par instance du pont Traccar pour l'élection de leader (verrou Redis).
  // En environnement conteneurisé (Docker/Kubernetes/Render), process.pid vaut quasi
  // toujours 1 : deux replicas partageraient la même identité "1" et ne pourraient pas
  // distinguer une vraie perte de lock d'un faux positif (deux instances croiraient être
  // leader). HOSTNAME = nom du conteneur/pod (distinct entre replicas), combiné à un UUID
  // pour éliminer toute collision même si HOSTNAME était partagé. Généré UNE SEULE FOIS au
  // chargement de la classe, jamais recalculé.
  private readonly instanceId = `${process.env.HOSTNAME || 'unknown'}-${randomUUID()}`;
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
    @Optional() private alertService: AlertService | null,
    @Optional() @Inject(REDIS_CLIENT) private redis: Redis | null,
  ) {
    this.traccarUrl = this.configService.get<string>('TRACCAR_URL', 'http://traccar:8082');
    this.traccarUser = this.configService.get<string>('TRACCAR_USER', 'admin');
    this.traccarPassword = this.configService.get<string>('TRACCAR_PASSWORD', 'admin');

    if (this.traccarUser === 'admin' && this.traccarPassword === 'admin') {
      this.logger.warn(
        'TRACCAR_USER/TRACCAR_PASSWORD not configured — using default credentials, change in production',
      );
    }
  }

  private disconnectStartTime: number | null = null;
  private disconnectionMonitorTimer: ReturnType<typeof setInterval> | null = null;
  private inactiveNotified = false;
  private isLeader = false;
  private leaderRenewTimer: ReturnType<typeof setInterval> | null = null;
  private leaderRetryTimer: ReturnType<typeof setInterval> | null = null;

  async onModuleInit() {
    this.logger.log(
      `Traccar bridge: instance initialisée (id=${this.instanceId}, HOSTNAME=${process.env.HOSTNAME || 'unknown'}, pid=${process.pid})`,
    );
    if (this.traccarUrl === 'http://traccar:8082' || this.traccarUrl === 'disabled') {
      this.logger.warn('Traccar bridge: TRACCAR_URL not configured — bridge inactive');
      await this.notifyInactiveOnce();
      return;
    }

    const nodeEnv = process.env.NODE_ENV || 'development';
    if (
      nodeEnv === 'production' &&
      (this.traccarUser === 'admin' || this.traccarPassword === 'admin')
    ) {
      throw new Error(
        'TRACCAR_USER/TRACCAR_PASSWORD doivent être configurés en production quand TRACCAR_URL est actif',
      );
    }

    this.startSilentDeviceCheck();
    this.startHealthCheck();
    this.startNeverConnectedCheck();
    this.startDisconnectionMonitor();

    if (this.redis) {
      await this.tryBecomeLeader();
      this.leaderRetryTimer = setInterval(() => this.tryBecomeLeader(), LEADER_RETRY_INTERVAL_MS);
    } else {
      this.logger.warn(
        'Traccar bridge: Redis not available — running without leader election (single instance mode)',
      );
      await this.connect();
    }
  }

  private async notifyInactiveOnce(): Promise<void> {
    if (this.inactiveNotified) return;
    this.inactiveNotified = true;
    try {
      if (this.alertService) {
        await this.alertService.send({
          level: 'warning',
          title: 'Pont Traccar non configuré',
          message:
            "TRACCAR_URL n'est pas défini — le pont Traccar est inactif. Les traceurs GPS physiques ne transmettront aucune position.",
          metadata: { service: 'traccar-bridge' },
        });
      } else {
        this.logger.warn('[PLATFORM ALERT] Pont Traccar non configuré');
      }
    } catch (err: any) {
      this.logger.error('Failed to send platform alert: Traccar inactive', err);
    }
  }

  private startDisconnectionMonitor() {
    this.disconnectionMonitorTimer = setInterval(async () => {
      if (!this.connected && this.disconnectStartTime) {
        const elapsedMin = (Date.now() - this.disconnectStartTime) / 60000;
        if (elapsedMin > 15 && this.disconnectStartTime) {
          try {
            if (this.alertService) {
              await this.alertService.send({
                level: 'critical',
                title: 'Pont Traccar hors ligne prolongé',
                message: `Le pont Traccar est déconnecté depuis ${Math.round(elapsedMin)} minutes (${this.reconnectAttempts} tentatives)`,
                metadata: {
                  service: 'traccar-bridge',
                  reconnectAttempts: this.reconnectAttempts,
                  elapsedMinutes: Math.round(elapsedMin),
                },
              });
            } else {
              this.logger.warn(
                `[PLATFORM ALERT] Pont Traccar hors ligne depuis ${Math.round(elapsedMin)} min`,
              );
            }
          } catch (err: any) {
            this.logger.error('Failed to send platform alert: Traccar disconnected', err);
          }
        }
      }
    }, 60000);
  }

  private async tryBecomeLeader(): Promise<boolean> {
    if (!this.redis) return false;
    if (this.isLeader) return true;

    try {
      const acquired = await this.redis.call(
        'SET',
        LEADER_KEY,
        this.instanceId,
        'NX',
        'EX',
        String(LEADER_TTL_S),
      );
      if (acquired === 'OK') {
        this.isLeader = true;
        this.logger.log(`Traccar bridge: became leader (instance=${this.instanceId})`);
        this.startLeaderRenew();
        await this.connect();
        return true;
      }
      return false;
    } catch (err: any) {
      this.logger.error(`Leader election error: ${err.message}`);
      return false;
    }
  }

  private startLeaderRenew() {
    this.stopLeaderRenew();
    this.leaderRenewTimer = setInterval(async () => {
      if (!this.redis || !this.isLeader) return;
      try {
        const current = await this.redis.get(LEADER_KEY);
        if (current !== this.instanceId) {
          this.isLeader = false;
          this.logger.warn(
            `Traccar bridge: lock repris par une autre instance (instance=${this.instanceId}, détenteur=${current || 'inconnu'}) — perte réelle de leadership`,
          );
          this.disconnect();
          this.stopLeaderRenew();
          return;
        }
        await this.redis.expire(LEADER_KEY, LEADER_TTL_S);
      } catch (err: any) {
        this.logger.error(`Leader renewal failed: ${err.message}`);
      }
    }, LEADER_RENEW_INTERVAL_MS);
  }

  private stopLeaderRenew() {
    if (this.leaderRenewTimer) {
      clearInterval(this.leaderRenewTimer);
      this.leaderRenewTimer = null;
    }
  }

  private async stepDown() {
    if (!this.redis) return;
    this.isLeader = false;
    this.stopLeaderRenew();
    try {
      const current = await this.redis.get(LEADER_KEY);
      // Ne supprime JAMAIS le lock d'une autre instance légitime : si le détenteur n'est
      // pas cette instance (ex. un nouveau leader élu après notre expiration), on s'abstient.
      if (current === this.instanceId) {
        await this.redis.del(LEADER_KEY);
        this.logger.log(`Traccar bridge: stepped down as leader (instance=${this.instanceId})`);
      }
    } catch (err: any) {
      this.logger.error(`Step down error: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    await this.stepDown();
    this.disconnect();
    if (this.leaderRenewTimer) clearInterval(this.leaderRenewTimer);
    if (this.leaderRetryTimer) clearInterval(this.leaderRetryTimer);
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

  async diagnosePlatformConfig(): Promise<TraccarDiagnoseReport> {
    const urlConfigured =
      this.traccarUrl !== 'http://traccar:8082' && this.traccarUrl !== 'disabled';
    const userConfigured = this.traccarUser !== 'admin';
    const passwordConfigured = this.traccarPassword !== 'admin';
    const fullyConfigured = urlConfigured && userConfigured && passwordConfigured;

    const report: TraccarDiagnoseReport = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      config: {
        urlConfigured,
        userConfigured,
        passwordConfigured,
        urlIsDefault: !urlConfigured,
        fullyConfigured,
        note: fullyConfigured
          ? 'TRACCAR_URL/USER/PASSWORD configurés et non-défauts'
          : "Configuration incomplète ou valeurs par défaut — l'authentification n'est pas tentée",
      },
      authentication: { attempted: false, success: null, httpStatus: null, error: null },
      devices: {
        exposedByApi: true,
        success: false,
        httpStatus: null,
        error: null,
        count: 0,
        protocolInferenceAvailable: false,
        protocolNote:
          "Le Device Traccar n'expose pas de champ protocol standard (schéma REST : id, name, uniqueId, status, disabled, lastUpdate, positionId, groupId, phone, model, contact, category, attributes). Le protocole est inféré depuis la dernière position (Position.protocol) quand elle est disponible.",
        items: [],
      },
      protocolPort: {
        exposedByApi: false,
        message:
          "Le port d'écoute par protocole (ex: port GT06) n'est PAS exposé par l'API REST Traccar — à confirmer manuellement dans l'interface https://server.traccar.org lors de la création ou de la consultation du device.",
        reference: 'RAPPORT_PORTS_TRACCAR.md — section « Traccar Cloud (production) »',
      },
    };

    if (!fullyConfigured) {
      report.authentication = {
        attempted: false,
        success: null,
        httpStatus: null,
        error:
          'TRACCAR_URL/USER/PASSWORD non configurés ou valeurs par défaut — authentification non tentée',
      };
      report.devices.error =
        'Authentification non tentée (configuration incomplète) — devices non récupérés';
      return report;
    }

    let sessionCookie: string | null = null;
    try {
      const login = await this.performSessionLogin();
      if (login.ok) {
        sessionCookie = login.cookie;
        report.authentication = {
          attempted: true,
          success: true,
          httpStatus: login.httpStatus,
          error: null,
        };
      } else {
        report.authentication = {
          attempted: true,
          success: false,
          httpStatus: login.httpStatus,
          error: login.error,
        };
      }
    } catch (err: unknown) {
      report.authentication = {
        attempted: true,
        success: false,
        httpStatus: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (sessionCookie) {
      try {
        const devicesResponse = await fetch(`${this.traccarUrl}/api/devices`, {
          headers: { Cookie: sessionCookie },
          signal: AbortSignal.timeout(15000),
        });
        report.devices.httpStatus = devicesResponse.status;

        if (!devicesResponse.ok) {
          report.devices.error = `Traccar /api/devices: HTTP ${devicesResponse.status}`;
        } else {
          const rawDevices: TraccarApiDevice[] = await devicesResponse.json();
          const positionsProtocols = new Map<number, string>();

          try {
            const positionsResponse = await fetch(`${this.traccarUrl}/api/positions`, {
              headers: { Cookie: sessionCookie },
              signal: AbortSignal.timeout(15000),
            });
            if (positionsResponse.ok) {
              const positions: TraccarApiPosition[] = await positionsResponse.json();
              for (const pos of positions) {
                if (pos && typeof pos.deviceId === 'number' && typeof pos.protocol === 'string') {
                  positionsProtocols.set(pos.deviceId, pos.protocol);
                }
              }
            }
          } catch {
            // l'inférence de protocole par position est non bloquante
          }

          report.devices.items = rawDevices.map((device) => {
            let protocol: string | null = null;
            let protocolSource: TraccarDiagnoseDevice['protocolSource'] = null;
            if (typeof device.protocol === 'string') {
              protocol = device.protocol;
              protocolSource = 'device_champ';
            } else if (typeof device?.attributes?.protocol === 'string') {
              protocol = device.attributes.protocol;
              protocolSource = 'device_attributes';
            } else if (positionsProtocols.has(device.id)) {
              protocol = positionsProtocols.get(device.id)!;
              protocolSource = 'position_traccar';
            }
            return {
              id: device.id,
              name: device.name,
              uniqueId: device.uniqueId,
              status: device.status,
              disabled: device.disabled,
              lastUpdate: device.lastUpdate,
              protocol,
              protocolSource,
            };
          });
          report.devices.protocolInferenceAvailable = positionsProtocols.size > 0;
          report.devices.success = true;
          report.devices.count = report.devices.items.length;
        }
      } catch (err: unknown) {
        report.devices.error = err instanceof Error ? err.message : String(err);
      }
    } else {
      report.devices.error =
        'Session impossible — devices non récupérés (voir field authentication)';
    }

    return report;
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
        // Session morte (cookie expiré / invalidé côté Traccar) alors que le socket est
        // toujours "connecté" : AVANT, on attendait passivement le timer de renouvellement
        // (30 min) — le pont restait aveugle sans recevoir aucune position pendant 30 min.
        // On déclenche une reconnexion proactive (nouvelle session + re-backfill).
        if (!response.ok && this.connected) {
          this.logger.warn('Traccar health check failed — forcing reconnection');
          // disconnect() ferme le socket + libère la session AVANT de replanifier
          // (sinon connect() ouvrirait un 2e socket pendant que l'ancien est encore là).
          this.disconnect();
          this.scheduleReconnect();
        }
      } catch (err: any) {
        this.logger.warn(`Traccar health check: Traccar serveur injoignable — ${err.message}`);
        // Serveur injoignable : on force aussi une reconnexion (backoff exponentiel) pour
        // rétablir le flux dès que Traccar revient, au lieu d'attendre le timer de session.
        if (this.connected) {
          this.disconnect();
          this.scheduleReconnect();
        }
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

        // Une position suspecte prouve quand même que le traceur a été vu connecté :
        // l'alerte "jamais connecté" ne doit PAS se déclencher pour un traceur dont les
        // seules positions seraient suspectes.
        const lastPos = await this.trackingService.getLastPosition(vehicle.id, false);
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

      // Une position suspecte prouve quand même que le traceur a transmis récemment :
      // l'évaluation de la "silence" (device offline) doit s'appuyer sur la DERNIÈRE
      // position reçue quelle qu'elle soit, sinon un traceur n'envoyant que des points
      // suspects serait déclaré offline à tort.
      const lastPos = await this.trackingService.getLastPosition(vehicle.id, false);
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

  private async performSessionLogin(): Promise<
    | { ok: true; cookie: string; httpStatus: number }
    | { ok: false; httpStatus: number | null; error: string }
  > {
    const loginResponse = await fetch(`${this.traccarUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(this.traccarUser)}&password=${encodeURIComponent(this.traccarPassword)}`,
    });

    if (!loginResponse.ok) {
      return {
        ok: false,
        httpStatus: loginResponse.status,
        error: `Traccar authentication failed: HTTP ${loginResponse.status}`,
      };
    }

    const setCookie = loginResponse.headers.get('set-cookie');
    if (!setCookie) {
      return {
        ok: false,
        httpStatus: loginResponse.status,
        error: 'Traccar did not return a session cookie',
      };
    }

    const match = setCookie.match(/JSESSIONID=([^;]+)/);
    if (!match) {
      return {
        ok: false,
        httpStatus: loginResponse.status,
        error: 'Traccar session cookie (JSESSIONID) not found',
      };
    }

    return { ok: true, cookie: `JSESSIONID=${match[1]}`, httpStatus: loginResponse.status };
  }

  private async authenticate(): Promise<string> {
    const result = await this.performSessionLogin();
    if (!result.ok) {
      throw new Error(result.error);
    }

    this.sessionCookie = result.cookie;
    this.logger.log('Traccar REST session established');

    this.scheduleSessionRenewal();
    return result.cookie;
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
    if (this.redis && !this.isLeader) {
      this.logger.debug('Traccar bridge: not leader — skipping connect');
      return;
    }
    try {
      const cookie = await this.authenticate();
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
    if (!this.isLeader && this.redis) return;
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

  /**
   * Résout le driverId EN VIGUEUR au moment du fix GPS via VehicleAssignmentHistory :
   * ligne (vehicleId = ce véhicule) telle que assignedAt <= fix_time <= (unassignedAt ?? now()).
   * Retourne null si AUCUNE affectation ne couvre cet instant — la position est alors
   * enregistrée avec driverId null (trace GPS jamais perdue) plutôt que d'être droppée.
   */
  private async resolveDriverIdAtTimestamp(
    vehicleId: string,
    timestamp: Date,
  ): Promise<string | null> {
    const assignment = await this.prisma.vehicleAssignmentHistory.findFirst({
      where: {
        vehicleId,
        assignedAt: { lte: timestamp },
        OR: [{ unassignedAt: null }, { unassignedAt: { gte: timestamp } }],
      },
      orderBy: { assignedAt: 'desc' },
      select: { driverId: true },
    });
    return assignment?.driverId ?? null;
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
          // Borne "from" du backfill : doit refléter la DERNIÈRE position STOCKÉE (même
          // suspecte), sinon on re-fetchrait des positions déjà en base (doublons).
          const lastPos = await this.trackingService.getLastPosition(vehicle.id, false);
          if (lastPos) lastTs = lastPos.timestamp;
        }

        const rawFrom = lastTs || new Date(now.getTime() - BACKFILL_MAX_HOURS * 3600000);
        // Marge anti-doublon : l'API /api/positions de Traccar traite `from` de façon
        // INCLUSIVE (Condition.Between → SQL BETWEEN, fixTime >= from AND fixTime <= to,
        // cf. source Traccar PositionUtil.getPositionsStream). Sans marge, lastTs (la
        // dernière position déjà traitée) serait re-fetchée à chaque reconnexion et
        // réinsérée en double. On décale donc la borne de +1s pour ne plus refetcher
        // le dernier point déjà stocké.
        const from = new Date(rawFrom.getTime() + 1000);

        const fromLimit = new Date(now.getTime() - BACKFILL_MAX_HOURS * 3600000);
        const effectiveFrom = from > fromLimit ? from : fromLimit;

        if (effectiveFrom >= now) continue;

        try {
          const url = `${this.traccarUrl}/api/positions?deviceId=${vehicle.traccarDeviceId}&from=${effectiveFrom.toISOString()}&to=${now.toISOString()}`;
          const response = await fetch(url, {
            headers: { Cookie: this.sessionCookie },
            // Un serveur Traccar bloqué ne doit pas geler le backfill de TOUS les devices
            // (le loop par véhicule s'arrêterait sur ce fetch sans timeout).
            signal: AbortSignal.timeout(20000),
          });

          if (!response.ok) {
            this.logger.warn(
              `Backfill fetch failed for device ${vehicle.traccarDeviceId}: HTTP ${response.status}`,
            );
            continue;
          }

          const positions: TraccarPosition[] = await response.json();
          if (positions.length === 0) continue;

          this.logger.log(
            `Backfill: ${positions.length} positions for device ${vehicle.traccarDeviceId}`,
          );

          const toInsert: Array<{
            latitude: number;
            longitude: number;
            speed: number;
            heading: number;
            altitude: number;
            accuracy: number;
            suspect: boolean;
            location: string;
            timestamp: Date;
            companyId: string;
            deliveryId: string | null | undefined;
            vehicleId: string;
            driverId: string | null;
            source: 'physical_tracker';
          }> = [];

          // N+1 : avant, resolveDriverIdAtTimestamp faisait UNE requête
          // vehicleAssignmentHistory.findFirst PAR position backfillée (un device avec
          // 500 positions tamponnées = 500 requêtes séquentielles, bloquant le pont). On
          // charge UNE SEULE FOIS l'historique complet du véhicule (trié par assignedAt)
          // puis on résout chaque fix en mémoire.
          const assignments = await this.prisma.vehicleAssignmentHistory.findMany({
            where: { vehicleId: vehicle.id },
            orderBy: { assignedAt: 'asc' },
            select: { driverId: true, assignedAt: true, unassignedAt: true },
          });
          const resolveDriver = (timestamp: Date): string | null => {
            // Dernière affectation dont assignedAt <= fix_time ET (unassignedAt null ou >= fix_time).
            for (let i = assignments.length - 1; i >= 0; i--) {
              const a = assignments[i];
              if (a.assignedAt.getTime() > timestamp.getTime()) continue;
              if (a.unassignedAt === null || a.unassignedAt.getTime() >= timestamp.getTime()) {
                return a.driverId;
              }
            }
            return null;
          };

          let lastBackfillPos: { latitude: number; longitude: number; timestamp: Date } | null =
            null;
          if (this.redis) {
            const stored = await this.redis.get(`traccar:last_position:${vehicle.traccarDeviceId}`);
            if (stored) {
              // Référence de téléportation du backfill : dernier point FIABLE (exclut
              // les positions suspectes), cohérent avec detectTeleportation — comparer
              // contre un point déjà aberrant propagerait la fausse téléportation.
              const lastDbPos = await this.trackingService.getLastPosition(vehicle.id);
              if (lastDbPos) {
                lastBackfillPos = {
                  latitude: lastDbPos.latitude,
                  longitude: lastDbPos.longitude,
                  timestamp: lastDbPos.timestamp,
                };
              }
            }
          }

          for (const pos of positions) {
            const timestamp = this.parseTimestamp(pos);
            if (!this.isValidCoordinates(pos.latitude, pos.longitude)) continue;
            if (pos.valid === false) {
              this.logger.warn(
                `Backfill: position LBS rejetée (valid=false) pour device ${pos.deviceId}`,
              );
              continue;
            }

            const speedMs = (pos.speed || 0) * 0.514444;
            const { accuracy } = computeCombinedAccuracy(pos.accuracy, pos.attributes);

            // MÊME décision de téléportation que le chemin temps réel
            // (evaluateTeleportation, source unique dans teleportation.utils) : la
            // détection du backfill recalculait un seuil 55.56 * max(1, accuracy/10) SANS
            // plafond, alors que le temps réel plafonne à x1.5 — un device à accuracy
            // dégradée (50-100m) voyait son seuil gonflé jusqu'à x5-10 et des vrais sauts
            // passaient suspects côté backfill mais pas côté temps réel (et inversement).
            let suspect = false;
            if (lastBackfillPos) {
              const evaluation = evaluateTeleportation(
                lastBackfillPos,
                pos.latitude,
                pos.longitude,
                timestamp,
                accuracy,
              );
              suspect = evaluation.suspect;
              if (suspect) {
                this.logger.warn(
                  `Backfill teleportation suspect (${evaluation.reason}): vehicle=${vehicle.id} distance=${Math.round(evaluation.distance)}m time=${evaluation.timeDiffSec.toFixed(1)}s speed=${(evaluation.speedMs * 3.6).toFixed(1)}km/h`,
                );
              }
            }
            lastBackfillPos = { latitude: pos.latitude, longitude: pos.longitude, timestamp };

            toInsert.push({
              latitude: pos.latitude,
              longitude: pos.longitude,
              speed: speedMs,
              heading: pos.course || 0,
              altitude: pos.altitude || 0,
              accuracy,
              suspect,
              location: `POINT(${pos.longitude} ${pos.latitude})`,
              timestamp,
              companyId: vehicle.companyId,
              deliveryId: null,
              vehicleId: vehicle.id,
              // DriverId au moment de CE fix GPS (pas l'affectation courante) :
              // sur un backfill, les positions antérieures à un changement de
              // chauffeur gardent l'ANCIEN driverId, les postérieures le NOUVEAU.
              driverId: resolveDriver(timestamp),
              source: 'physical_tracker',
            });
          }

          if (toInsert.length > 0) {
            // Garde-fou anti-doublons, indépendant de la marge effectiveFrom : on charge
            // en UNE requête groupée les timestamps déjà présents en base pour ce véhicule
            // sur la fenêtre couverte par le lot, puis on filtre toInsert avant insertion.
            // Couvre le cas où la marge +1s est insuffisante (ex: clé Redis perdue au
            // redémarrage) et évite le problème N+1 (une requête par position) déjà
            // identifié dans l'audit. On conserve le choix actuel de ne pas générer
            // d'alertes sur les positions de backfill (donnée historique).
            const windowStart = new Date(Math.min(...toInsert.map((p) => p.timestamp.getTime())));
            const windowEnd = new Date(Math.max(...toInsert.map((p) => p.timestamp.getTime())));
            const existing = await this.prisma.gpsPosition.findMany({
              where: { vehicleId: vehicle.id, timestamp: { gte: windowStart, lte: windowEnd } },
              select: { timestamp: true },
            });
            const existingTs = new Set(existing.map((e) => e.timestamp.getTime()));
            const uniqueToInsert = toInsert.filter((p) => !existingTs.has(p.timestamp.getTime()));

            if (uniqueToInsert.length > 0) {
              await this.prisma.gpsPosition.createMany({ data: uniqueToInsert });
              this.logger.log(
                `Backfill: inserted ${uniqueToInsert.length} positions for device ${vehicle.traccarDeviceId} (no alerts generated — historical data)`,
              );

              if (this.redis) {
                // MAX des timestamps réellement insérés (pas forcément le dernier élément
                // du tableau) : le filtre anti-doublons peut retirer des positions en fin
                // de lot (déjà en base), et lastTs servirait alors à re-fetcher des
                // positions déjà traitées à la prochaine reconnexion.
                const maxTs = new Date(
                  Math.max(...uniqueToInsert.map((p) => p.timestamp.getTime())),
                );
                await this.redis.set(
                  `traccar:last_position:${vehicle.traccarDeviceId}`,
                  maxTs.toISOString(),
                );
              }
            } else {
              this.logger.log(
                `Backfill: 0 new positions for device ${vehicle.traccarDeviceId} (${toInsert.length} filtered as duplicates)`,
              );
            }
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

      if (pos.valid === false) {
        this.logger.warn(
          `Position LBS rejetée (valid=false) pour device ${pos.deviceId} ` +
            `à ${pos.latitude},${pos.longitude} — seul un fix GPS réel est accepté`,
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
        },
      });

      if (!vehicleMapping) return;

      // Résolution du chauffeur AU MOMENT du fix GPS (VehicleAssignmentHistory),
      // jamais l'affectation COURANTE (driver.vehicleId) : sur un backfill, un
      // changement de chauffeur pendant la fenêtre ne doit pas faire hériter les
      // positions antérieures du nouveau driverId. Si AUCUNE affectation ne couvre
      // cet instant, la position est ENREGISTRÉE quand même avec driverId null
      // (jamais perdue) — GpsPosition.driverId est nullable depuis la migration
      // 20260805183000_gps_position_driver_id_nullable.
      const driverId = await this.resolveDriverIdAtTimestamp(vehicleMapping.id, timestamp);

      // Nom du chauffeur pour le broadcast : celui du driver RÉSOLU (au moment du
      // fix), pas le chauffeur courant du véhicule.
      let driverName = 'Traccar GPS';
      if (driverId) {
        const resolvedDriver = await this.prisma.driver.findUnique({
          where: { id: driverId },
          select: { user: { select: { firstName: true, lastName: true } } },
        });
        const driverUser = resolvedDriver?.user;
        if (driverUser) {
          driverName = `${driverUser.firstName} ${driverUser.lastName}`;
        }
      }

      const currentDelivery = driverId
        ? await this.prisma.delivery.findFirst({
            where: {
              driverId,
              status: 'in_progress',
              deletedAt: null,
            },
            select: { id: true },
          })
        : null;

      const { accuracy: derivedAccuracy, hdopInfo } = computeCombinedAccuracy(
        pos.accuracy,
        pos.attributes,
      );
      this.logger.debug(`Traccar device ${pos.deviceId}: ${hdopInfo}`);

      const updateDto = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed: (pos.speed || 0) * 0.514444,
        heading: pos.course || 0,
        altitude: pos.altitude || 0,
        accuracy: derivedAccuracy,
        timestamp: timestamp.toISOString(),
        vehicleId: vehicleMapping.id,
        deliveryId: currentDelivery?.id,
      };

      const validated = plainToInstance(UpdatePositionDto, updateDto);
      const errors = validateSync(validated, { whitelist: true, forbidNonWhitelisted: false });
      if (errors.length > 0) {
        this.logger.warn(
          `Traccar position validation failed for device ${pos.deviceId}: ${errors.map((e) => e.toString()).join(', ')}`,
        );
        return;
      }

      let position;
      try {
        position = await this.trackingService.savePosition(
          driverId,
          validated,
          vehicleMapping.companyId,
          // Le pont Traccar est toujours une source 'physical_tracker'.
          'physical_tracker',
        );

        if (this.redis) {
          await this.redis.set(`traccar:last_position:${pos.deviceId}`, timestamp.toISOString());
        }
      } catch (saveErr: any) {
        this.logger.error(
          `Save position failed for device ${pos.deviceId}: ${saveErr.message} — queueing`,
        );
        await this.queuePendingPosition(pos);
        return;
      }

      if (position) {
        this.lastPositionReceivedAt = Date.now();
        this.trackingGateway.broadcastDataUpdate(vehicleMapping.companyId, 'position', {
          driverId: driverId ?? undefined,
          latitude: pos.latitude,
          longitude: pos.longitude,
          timestamp: updateDto.timestamp,
        });

        const broadcast = {
          driverId: driverId ?? undefined,
          driverName,
          latitude: pos.latitude,
          longitude: pos.longitude,
          speed: updateDto.speed,
          heading: updateDto.heading,
          altitude: updateDto.altitude,
          accuracy: updateDto.accuracy,
          suspect: position.suspect,
          confidence: computeConfidence(
            updateDto.accuracy,
            position.suspect,
            updateDto.speed,
            updateDto.heading,
          ),
          timestamp: updateDto.timestamp,
          deliveryId: updateDto.deliveryId ?? undefined,
          vehicleId: vehicleMapping.id,
        };

        this.trackingGateway.broadcastToCompany(
          vehicleMapping.companyId,
          'positionUpdate',
          broadcast,
        );
      }
    } catch (err: any) {
      this.logger.error(`Traccar position handling error: ${err.message}`);
    }
  }

  private parseTimestamp(pos: TraccarPosition): Date {
    const raw = pos.fixTime || pos.deviceTime;
    if (!raw) {
      this.logger.warn(
        `Traccar device ${pos.deviceId}: missing fixTime/deviceTime — using server time`,
      );
      return new Date();
    }
    const date = new Date(raw);
    if (isNaN(date.getTime())) {
      this.logger.warn(
        `Traccar device ${pos.deviceId}: invalid timestamp "${raw}" — using server time`,
      );
      return new Date();
    }
    return date;
  }

  private isValidCoordinates(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
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
          this.logger.warn(
            `Purging stale pending position from device ${pos.deviceId} (queued >1h)`,
          );
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
