import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import {
  TrackerProtocol,
  UnifiedGpsEvent,
  DeviceCapability,
  DeviceCommandRequest,
} from '../interfaces/unified-gps-event';

const START_BITS = [0x78, 0x78];
const STOP_BITS = [0x0D, 0x0A];

const PROTOCOL_LOGIN = 0x01;
const PROTOCOL_GPS = 0x12;
const PROTOCOL_ALARM = 0x16;

function crc16(data: Buffer): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 0x0001) {
        crc = (crc >> 1) ^ 0x8408;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return crc & 0xFFFF;
}

function isGt06Packet(packet: Buffer): boolean {
  if (packet.length < 10) return false;
  if (!(packet[0] === START_BITS[0] && packet[1] === START_BITS[1])) return false;
  if (!(packet[packet.length - 2] === STOP_BITS[0] && packet[packet.length - 1] === STOP_BITS[1])) return false;
  return true;
}

export class Gt06Driver implements GpsProtocolDriver {
  readonly protocolName = TrackerProtocol.GT06;
  readonly transport = 'tcp';
  readonly defaultPort = 5055;

  canHandle(rawPacket: Buffer): boolean {
    return isGt06Packet(rawPacket);
  }

  parse(rawPacket: Buffer): UnifiedGpsEvent | null {
    if (!isGt06Packet(rawPacket)) return null;

    const packetLen = rawPacket[2];
    const protocolNum = rawPacket[3];
    const bodyEnd = 4 + packetLen - 4;
    const body = rawPacket.slice(4, bodyEnd);
    const crcData = rawPacket.slice(2, bodyEnd);
    const expectedCrc = rawPacket.readUInt16BE(bodyEnd);

    const actualCrc = crc16(crcData);
    if (actualCrc !== expectedCrc) return null;

    if (protocolNum === PROTOCOL_GPS || protocolNum === PROTOCOL_ALARM) {
      return this.parsePosition(rawPacket, protocolNum);
    }

    return null;
  }

  private parsePosition(packet: Buffer, protocolNum: number): UnifiedGpsEvent {
    const BODY_START = 4;
    const dateStr = packet.toString('ascii', BODY_START, BODY_START + 12);
    const latRaw = packet.readUInt32BE(BODY_START + 18);
    const lngRaw = packet.readUInt32BE(BODY_START + 22);

    const latDeg = (latRaw & 0x7FFFFFFF) / 1000000;
    const latFlag = (latRaw >> 31) & 1;
    const lat = latFlag === 0 ? latDeg : -latDeg;

    const lngDeg = (lngRaw & 0x7FFFFFFF) / 1000000;
    const lngFlag = (lngRaw >> 31) & 1;
    const lng = lngFlag === 0 ? lngDeg : -lngDeg;

    const speedRaw = packet.readUInt16BE(BODY_START + 26);
    const courseRaw = packet.readUInt16BE(BODY_START + 28);

    const year = parseInt(dateStr.slice(0, 2), 10) + 2000;
    const month = parseInt(dateStr.slice(2, 4), 10) - 1;
    const day = parseInt(dateStr.slice(4, 6), 10);
    const hours = parseInt(dateStr.slice(6, 8), 10);
    const minutes = parseInt(dateStr.slice(8, 10), 10);
    const seconds = parseInt(dateStr.slice(10, 12), 10);
    const timestamp = new Date(Date.UTC(year, month, day, hours, minutes, seconds));

    return {
      deviceId: '',
      imei: '',
      protocol: TrackerProtocol.GT06,
      latitude: lat,
      longitude: lng,
      speed: (speedRaw / 10) / 3.6,
      heading: courseRaw,
      accuracy: 10,
      timestamp,
      alarms: protocolNum === PROTOCOL_ALARM ? ['sos'] : undefined,
      raw: { rawHex: packet.toString('hex') },
    };
  }

  encodeCommand(command: DeviceCommandRequest): Buffer | null {
    switch (command.command) {
      case 'reboot':
        return this.buildSmsCommand('reboot');
      case 'set_interval':
        return this.buildSmsCommand(`upload,${command.parameters?.intervalSeconds || 10}`);
      case 'set_apn':
        return this.buildSmsCommand(`apn,${command.parameters?.apn || ''}`);
      case 'fetch_config':
        return this.buildSmsCommand('check');
      default:
        return null;
    }
  }

  private buildSmsCommand(text: string): Buffer {
    return Buffer.from(text, 'ascii');
  }

  getCapabilities(): DeviceCapability[] {
    return ['gps', 'sos', 'battery', 'gsm_signal', 'satellites'];
  }

  extractImei(rawPacket: Buffer): string | null {
    if (!isGt06Packet(rawPacket)) return null;
    const protocolNum = rawPacket[3];
    if (protocolNum === PROTOCOL_LOGIN) {
      const imeiLen = rawPacket[4];
      return rawPacket.toString('ascii', 5, 5 + imeiLen);
    }
    return null;
  }
}
