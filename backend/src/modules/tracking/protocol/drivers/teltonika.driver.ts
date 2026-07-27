import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import {
  TrackerProtocol,
  UnifiedGpsEvent,
  DeviceCapability,
  DeviceCommandRequest,
} from '../interfaces/unified-gps-event';

export class TeltonikaDriver implements GpsProtocolDriver {
  readonly protocolName = TrackerProtocol.TELTONIKA;
  readonly transport = 'tcp';
  readonly defaultPort = 5056;

  canHandle(rawPacket: Buffer): boolean {
    if (rawPacket.length < 2) return false;
    const imeiLen = rawPacket[0];
    if (imeiLen > 0 && imeiLen <= 15 && rawPacket.length >= imeiLen + 1) {
      return true;
    }
    return this.isCodec8Packet(rawPacket);
  }

  parse(rawPacket: Buffer): UnifiedGpsEvent | null {
    if (this.isImeiPacket(rawPacket)) return null;
    if (!this.isCodec8Packet(rawPacket)) return null;
    return this.parseCodec8(rawPacket);
  }

  private isImeiPacket(packet: Buffer): boolean {
    if (packet.length < 2) return false;
    const imeiLen = packet[0];
    return imeiLen > 0 && imeiLen <= 15 && packet.length >= imeiLen + 1;
  }

  private isCodec8Packet(packet: Buffer): boolean {
    if (packet.length < 12) return false;
    const preamble = packet.readUInt32BE(0);
    if (preamble !== 0) return false;
    const codecId = packet[4];
    return codecId === 0x08 || codecId === 0x8E;
  }

  private parseCodec8(packet: Buffer): UnifiedGpsEvent | null {
    const preamble = packet.readUInt32BE(0);
    if (preamble !== 0) return null;

    const codecId = packet[4];
    const numberOfData1 = packet[5];

    if (numberOfData1 < 1) return null;

    const avlDataStart = 8;
    const avlRecordLength = codecId === 0x8E ? 36 : 24;

    const avlOffset = avlDataStart;
    if (avlOffset + avlRecordLength > packet.length) return null;

    const timestamp = packet.readUInt32BE(avlOffset);
    const priority = packet[avlOffset + 4];
    const lat = packet.readInt32BE(avlOffset + 5) / 10000000;
    const lng = packet.readInt32BE(avlOffset + 9) / 10000000;
    const altitude = packet.readUInt16BE(avlOffset + 13);
    const angle = packet.readUInt16BE(avlOffset + 15) / 100;
    const satellites = packet[avlOffset + 17];
    const speed = packet.readUInt16BE(avlOffset + 18) / 100;

    return {
      deviceId: '',
      imei: '',
      protocol: TrackerProtocol.TELTONIKA,
      latitude: lat,
      longitude: lng,
      speed: speed / 3.6,
      heading: angle,
      altitude,
      accuracy: satellites > 0 ? 10 : 50,
      satellites,
      timestamp: new Date(timestamp * 1000),
      raw: { rawHex: packet.toString('hex'), codecId, priority, numberOfData1 },
    };
  }

  encodeCommand(command: DeviceCommandRequest): Buffer | null {
    return null;
  }

  getCapabilities(): DeviceCapability[] {
    return ['gps', 'ignition', 'battery', 'temperature', 'mileage', 'engine_hours', 'gsm_signal', 'satellites'];
  }

  extractImei(rawPacket: Buffer): string | null {
    if (!this.isImeiPacket(rawPacket)) return null;
    const imeiLen = rawPacket[0];
    return rawPacket.toString('ascii', 1, 1 + imeiLen);
  }
}
