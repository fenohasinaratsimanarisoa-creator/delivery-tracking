import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as net from 'net';
import { ProtocolDetectionLayer } from './detection/protocol-detection-layer';
import { GpsProtocolRegistry } from './registry/gps-protocol-registry';
import { TrackerProtocol } from './interfaces/unified-gps-event';
import { GpsProtocolDriver } from './interfaces/gps-protocol-driver';
import { Gt06Driver } from './drivers/gt06.driver';
import { TeltonikaDriver } from './drivers/teltonika.driver';
import { Tk103Driver } from './drivers/tk103.driver';
import { H02Driver } from './drivers/h02.driver';

const DEFAULT_PORTS: { protocol: TrackerProtocol; port: number }[] = [
  { protocol: TrackerProtocol.GT06, port: 5055 },
  { protocol: TrackerProtocol.TELTONIKA, port: 5056 },
  { protocol: TrackerProtocol.H02, port: 5057 },
  { protocol: TrackerProtocol.TK103, port: 5058 },
];

const BUFFER_TIMEOUT_MS = 30000;
const BUFFER_MAX_SIZE = 4096;

interface TrackerConnection {
  socket: net.Socket;
  driver: GpsProtocolDriver;
  buffer: Buffer;
  lastActivity: number;
  imei: string | null;
}

@Injectable()
export class TrackerGatewayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrackerGatewayService.name);
  private servers: net.Server[] = [];
  private connections: Map<string, TrackerConnection> = new Map();
  private registry: GpsProtocolRegistry;

  constructor(private detectionLayer: ProtocolDetectionLayer) {
    this.registry = detectionLayer['registry'];
    this.registerBuiltinDrivers();
  }

  private registerBuiltinDrivers() {
    const drivers: GpsProtocolDriver[] = [
      new Gt06Driver(),
      new TeltonikaDriver(),
      new Tk103Driver(),
      new H02Driver(),
    ];
    for (const driver of drivers) {
      this.registry.register(driver);
      this.logger.log(`Driver enregistré: ${driver.protocolName} (port ${driver.defaultPort})`);
    }
  }

  async onModuleInit() {
    const enabledPorts = this.getEnabledPorts();
    for (const { protocol, port } of enabledPorts) {
      this.startListener(protocol, port);
    }
  }

  onModuleDestroy() {
    for (const server of this.servers) {
      server.close();
    }
    for (const [id, conn] of this.connections) {
      conn.socket.destroy();
    }
    this.servers = [];
    this.connections.clear();
  }

  private getEnabledPorts(): { protocol: TrackerProtocol; port: number }[] {
    const envPorts = process.env.TRACKER_PORTS;
    if (envPorts) {
      return envPorts.split(',').map((s) => {
        const [proto, portStr] = s.trim().split(':');
        return { protocol: proto as TrackerProtocol, port: parseInt(portStr, 10) };
      });
    }
    return DEFAULT_PORTS;
  }

  private startListener(protocol: TrackerProtocol, port: number) {
    const server = net.createServer((socket) => this.handleConnection(socket, protocol));

    server.on('error', (err) => {
      this.logger.error(`Tracker listener error on port ${port}: ${err.message}`);
    });

    server.listen(port, '0.0.0.0', () => {
      this.logger.log(`Tracker TCP listener started: ${protocol} on port ${port}`);
    });

    this.servers.push(server);
  }

  private handleConnection(socket: net.Socket, protocol: TrackerProtocol) {
    const remoteAddr = `${socket.remoteAddress}:${socket.remotePort}`;
    this.logger.debug(`New connection from ${remoteAddr}`);

    const conn: TrackerConnection = {
      socket,
      driver: this.registry.getDriver(protocol)!,
      buffer: Buffer.alloc(0),
      lastActivity: Date.now(),
      imei: null,
    };

    const connId = `${remoteAddr}-${Date.now()}`;
    this.connections.set(connId, conn);

    socket.on('data', (data: Buffer) => this.handleData(connId, conn, data));
    socket.on('close', () => {
      this.connections.delete(connId);
      this.logger.debug(`Connection closed: ${remoteAddr}`);
    });
    socket.on('error', (err) => {
      this.logger.error(`Socket error ${remoteAddr}: ${err.message}`);
      this.connections.delete(connId);
    });

    setTimeout(() => {
      if (this.connections.has(connId)) {
        const elapsed = Date.now() - conn.lastActivity;
        if (elapsed > BUFFER_TIMEOUT_MS) {
          this.logger.warn(`Tracker connection timeout: ${remoteAddr} (${elapsed}ms idle)`);
          socket.destroy();
          this.connections.delete(connId);
        }
      }
    }, BUFFER_TIMEOUT_MS);
  }

  private handleData(connId: string, conn: TrackerConnection, data: Buffer) {
    conn.lastActivity = Date.now();
    conn.buffer = Buffer.concat([conn.buffer, data]);

    if (conn.buffer.length > BUFFER_MAX_SIZE) {
      this.logger.warn(`Buffer overflow for ${conn.socket.remoteAddress}, discarding`);
      conn.buffer = Buffer.alloc(0);
      return;
    }

    if (!conn.imei) {
      const imei = conn.driver.extractImei(conn.buffer);
      if (imei) {
        conn.imei = imei;
        this.logger.log(`Tracker authenticated: IMEI=${imei} protocol=${conn.driver.protocolName}`);
        conn.buffer = Buffer.alloc(0);
      }
      return;
    }

    if (conn.buffer.length < 6) return;

    const event = conn.driver.parse(conn.buffer);
    if (event) {
      event.imei = conn.imei;
      this.logger.log(`Position reçue: IMEI=${event.imei} lat=${event.latitude.toFixed(4)} lng=${event.longitude.toFixed(4)} protocol=${conn.driver.protocolName}`);
      this.onPositionReceived(event).catch((err) =>
        this.logger.error(`Position processing error: ${err.message}`),
      );
      conn.buffer = Buffer.alloc(0);
    }
  }

  private async onPositionReceived(event: any): Promise<void> {
    this.logger.debug(`Événement unifié reçu: ${JSON.stringify({ imei: event.imei, lat: event.latitude, lng: event.longitude, protocol: event.protocol })}`);
  }
}
