import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import {
  TrackerProtocol,
  UnifiedGpsEvent,
  DeviceCapability,
  DeviceCommandRequest,
} from '../interfaces/unified-gps-event';

export class Tk103Driver implements GpsProtocolDriver {
  readonly protocolName = TrackerProtocol.TK103;
  readonly transport = 'tcp';
  readonly defaultPort = 5058;

  canHandle(rawPacket: Buffer): boolean {
    if (rawPacket.length < 6) return false;
    return rawPacket[0] === 0x28 && rawPacket[rawPacket.length - 1] === 0x29;
  }

  parse(rawPacket: Buffer): UnifiedGpsEvent | null {
    if (!this.canHandle(rawPacket)) return null;

    const content = rawPacket.toString('ascii');
    const imeiMatch = content.match(/BP00([\d]{15})/);
    if (!imeiMatch) return null;

    const imei = imeiMatch[1];

    const latMatch = content.match(/,([\d]{2})([\d.]{2,}),([NS]),/);
    const lngMatch = content.match(/,([\d]{3})([\d.]{2,}),([EW]),/);
    const speedCourseMatch = content.match(/,([\d.]+),([\d.]+),V,/);
    const dateMatch = content.match(/BR00([\d]{2})([\d]{2})([\d]{2})([\d]{2})([\d]{2})([\d]{2})/);

    if (!latMatch || !lngMatch) return null;

    const latDeg = parseInt(latMatch[1], 10);
    const latMin = parseFloat(latMatch[2]);
    const lat = (latDeg + latMin / 60) * (latMatch[3] === 'S' ? -1 : 1);

    const lngDeg = parseInt(lngMatch[1], 10);
    const lngMin = parseFloat(lngMatch[2]);
    const lng = (lngDeg + lngMin / 60) * (lngMatch[3] === 'W' ? -1 : 1);

    let timestamp = new Date();
    if (dateMatch) {
      const d = parseInt(dateMatch[1], 10);
      const m = parseInt(dateMatch[2], 10) - 1;
      const y = parseInt(dateMatch[3], 10) + 2000;
      const hh = parseInt(dateMatch[4], 10);
      const mm = parseInt(dateMatch[5], 10);
      const ss = parseInt(dateMatch[6], 10);
      timestamp = new Date(y, m, d, hh, mm, ss);
    }

    let speed: number | undefined;
    let course: number | undefined;
    if (speedCourseMatch) {
      speed = parseFloat(speedCourseMatch[1]);
      course = parseFloat(speedCourseMatch[2]);
    }

    return {
      deviceId: '',
      imei,
      protocol: TrackerProtocol.TK103,
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
    const match = content.match(/(\d{15})/);
    return match ? match[1] : null;
  }
}
