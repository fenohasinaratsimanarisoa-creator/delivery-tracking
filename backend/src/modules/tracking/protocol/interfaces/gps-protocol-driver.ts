import { TrackerProtocol, DeviceCapability, UnifiedGpsEvent, DeviceCommandRequest, DeviceCommandResult } from './unified-gps-event';

export type TransportType = 'tcp' | 'udp' | 'http' | 'websocket';

export interface GpsProtocolDriver {
  readonly protocolName: TrackerProtocol;
  readonly transport: TransportType;
  readonly defaultPort?: number;

  canHandle(rawPacket: Buffer): boolean;

  parse(rawPacket: Buffer): UnifiedGpsEvent | null;

  encodeCommand(command: DeviceCommandRequest): Buffer | null;

  getCapabilities(): DeviceCapability[];

  extractImei(rawPacket: Buffer): string | null;
}
