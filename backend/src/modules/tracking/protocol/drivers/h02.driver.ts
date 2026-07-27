import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import {
  TrackerProtocol,
  UnifiedGpsEvent,
  DeviceCapability,
  DeviceCommandRequest,
} from '../interfaces/unified-gps-event';

export class H02Driver implements GpsProtocolDriver {
  readonly protocolName = TrackerProtocol.H02;
  readonly transport = 'tcp';
  readonly defaultPort = 5057;

  canHandle(rawPacket: Buffer): boolean {
    if (rawPacket.length < 10) return false;
    return rawPacket[0] === 0x24 && rawPacket[rawPacket.length - 1] === 0x23;
  }

  parse(rawPacket: Buffer): UnifiedGpsEvent | null {
    if (!this.canHandle(rawPacket)) return null;

    const content = rawPacket.toString('ascii');

    const imeiMatch = content.match(/IM(\d{15})/);
    if (!imeiMatch) return null;
    const imei = imeiMatch[1];

    const latMatch = content.match(/,V(\d{4}\.\d{4}),([NS]),/);
    const lngMatch = content.match(/,(\d{5}\.\d{4}),([EW]),/);
    const speedMatch = content.match(/,([\d.]{1,}),([\d.]{1,}),(\d{6})/);

    if (!latMatch || !lngMatch) return null;

    const latDeg = parseInt(latMatch[1].slice(0, 2), 10);
    const latMin = parseFloat(latMatch[1].slice(2));
    const lat = (latDeg + latMin / 60) * (latMatch[2] === 'S' ? -1 : 1);

    const lngDeg = parseInt(lngMatch[1].slice(0, 3), 10);
    const lngMin = parseFloat(lngMatch[1].slice(3));
    const lng = (lngDeg + lngMin / 60) * (lngMatch[2] === 'W' ? -1 : 1);

    let speed: number | undefined;
    let course: number | undefined;
    let timestamp = new Date();
    if (speedMatch) {
      speed = parseFloat(speedMatch[1]);
      course = parseFloat(speedMatch[2]);
      const dateStr = speedMatch[3];
      const hh = parseInt(dateStr.slice(0, 2), 10);
      const mm = parseInt(dateStr.slice(2, 4), 10);
      const ss = parseInt(dateStr.slice(4, 6), 10);
      timestamp = new Date();
      timestamp.setHours(hh, mm, ss);
    }

    return {
      deviceId: '',
      imei,
      protocol: TrackerProtocol.H02,
      latitude: lat,
      longitude: lng,
      speed: speed ? speed * 0.514444 : undefined,
      heading: course,
      accuracy: 15,
      timestamp,
      raw: { rawText: content },
    };
  }

  encodeCommand(command: DeviceCommandRequest): Buffer | null {
    return null;
  }

  getCapabilities(): DeviceCapability[] {
    return ['gps', 'sos'];
  }

  extractImei(rawPacket: Buffer): string | null {
    if (!this.canHandle(rawPacket)) return null;
    const content = rawPacket.toString('ascii');
    const match = content.match(/IM(\d{15})/);
    return match ? match[1] : null;
  }
}
