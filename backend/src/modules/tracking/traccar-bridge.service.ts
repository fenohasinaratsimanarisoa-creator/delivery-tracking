import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from '../tracking/tracking.service';
import { TrackingGateway } from '../tracking/tracking.gateway';

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

@Injectable()
export class TraccarBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TraccarBridgeService.name);
  private socket: any = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly traccarUrl: string;
  private readonly traccarPort: number;
  private connected = false;
  private lastPositionTime = 0;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
    private trackingService: TrackingService,
    private trackingGateway: TrackingGateway,
  ) {
    this.traccarUrl = this.configService.get<string>('TRACCAR_URL', 'http://traccar:8082');
    this.traccarPort = this.configService.get<number>('TRACCAR_WS_PORT', 8082);
  }

  async onModuleInit() {
    if (this.traccarUrl === 'http://traccar:8082' || this.traccarUrl === 'disabled') {
      this.logger.warn('Traccar bridge: TRACCAR_URL not configured — bridge inactive');
      return;
    }
    await this.connect();
  }

  onModuleDestroy() {
    this.disconnect();
  }

  private async connect() {
    try {
      const WebSocket = (await import('ws')).default;
      const wsUrl = this.traccarUrl.replace(/^http/, 'ws') + '/api/socket';

      this.socket = new WebSocket(wsUrl);

      this.socket.on('open', () => {
        this.connected = true;
        this.logger.log(`Traccar bridge connected to ${wsUrl}`);
        this.socket.send('login admin:admin');
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

      this.socket.on('close', (code: number) => {
        this.connected = false;
        this.logger.warn(`Traccar bridge disconnected (code ${code}), reconnecting in 10s...`);
        this.scheduleReconnect();
      });

      this.socket.on('error', (err: Error) => {
        this.logger.error(`Traccar bridge socket error: ${err.message}`);
        this.socket?.close();
      });
    } catch (err: any) {
      this.logger.error(`Traccar bridge connection failed: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 10000);
  }

  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  private async handlePosition(pos: TraccarPosition) {
    try {
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
          driver: { select: { id: true, userId: true } },
        },
      });

      if (!vehicleMapping) return;

      const driver = vehicleMapping.driver;
      if (!driver?.userId) return;

      const updateDto = {
        latitude: pos.latitude,
        longitude: pos.longitude,
        speed: pos.speed * 0.514444, // knots → m/s
        heading: pos.course,
        altitude: pos.altitude || 0,
        accuracy: pos.accuracy || 10,
        timestamp: new Date(pos.fixTime || pos.deviceTime).toISOString(),
        vehicleId: vehicleMapping.id,
        deliveryId: undefined,
      };

      const position = await this.trackingService.savePosition(
        driver.id,
        updateDto as any,
        vehicleMapping.companyId,
      );

      if (position) {
        this.lastPositionTime = Date.now();
        this.trackingGateway.broadcastDataUpdate(vehicleMapping.companyId, 'position', {
          driverId: driver.id,
          latitude: pos.latitude,
          longitude: pos.longitude,
          timestamp: updateDto.timestamp,
        });

        const broadcast = {
          driverId: driver.id,
          driverName: 'Traccar GPS',
          latitude: pos.latitude,
          longitude: pos.longitude,
          speed: updateDto.speed,
          heading: updateDto.heading,
          altitude: updateDto.altitude,
          accuracy: updateDto.accuracy,
          suspect: position.suspect,
          timestamp: updateDto.timestamp,
          deliveryId: null,
          vehicleId: vehicleMapping.id,
        };

        this.trackingGateway.broadcastToCompany(vehicleMapping.companyId, 'positionUpdate', broadcast);
      }
    } catch (err: any) {
      this.logger.error(`Traccar position handling error: ${err.message}`);
    }
  }
}
