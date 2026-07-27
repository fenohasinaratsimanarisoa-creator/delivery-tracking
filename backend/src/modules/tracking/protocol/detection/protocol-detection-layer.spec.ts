import { ProtocolDetectionLayer } from './protocol-detection-layer';
import { GpsProtocolRegistry } from '../registry/gps-protocol-registry';
import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

class MockGt06Driver implements GpsProtocolDriver {
  protocolName = TrackerProtocol.GT06;
  transport = 'tcp' as const;
  defaultPort = 5055;
  canHandle(rawPacket: Buffer): boolean {
    return rawPacket.length > 4 &&
      rawPacket[0] === 0x78 && rawPacket[1] === 0x78;
  }
  parse(rawPacket: Buffer): any {
    if (this.canHandle(rawPacket)) {
      return {
        deviceId: 'dev-1',
        imei: '123456789012345',
        protocol: TrackerProtocol.GT06,
        latitude: -18.8792,
        longitude: 47.5079,
        timestamp: new Date(),
      };
    }
    return null;
  }
  encodeCommand(): Buffer | null { return null; }
  getCapabilities(): any[] { return ['gps']; }
  extractImei(rawPacket: Buffer): string | null {
    if (rawPacket.length > 4) {
      return rawPacket.slice(4).toString('ascii').replace(/[^0-9]/g, '').slice(0, 15) || null;
    }
    return null;
  }
}

describe('ProtocolDetectionLayer', () => {
  let registry: GpsProtocolRegistry;
  let layer: ProtocolDetectionLayer;

  beforeEach(() => {
    registry = new GpsProtocolRegistry();
    layer = new ProtocolDetectionLayer(registry);
  });

  it('returns undefined when no driver matches', () => {
    const packet = Buffer.from([0x00, 0x01, 0x02]);
    expect(layer.detect(packet)).toBeUndefined();
  });

  it('detects a driver for a matching packet', () => {
    const driver = new MockGt06Driver();
    registry.register(driver);

    const packet = Buffer.from([0x78, 0x78, 0x01, 0x00, 0x31, 0x32, 0x33]);
    expect(layer.detect(packet)).toBe(driver);
  });
});
