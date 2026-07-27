import { TrackerGatewayService } from './tracker-gateway.service';
import { ProtocolDetectionLayer } from './detection/protocol-detection-layer';
import { GpsProtocolRegistry } from './registry/gps-protocol-registry';
import { Gt06Driver } from './drivers/gt06.driver';

describe('TrackerGatewayService', () => {
  let registry: GpsProtocolRegistry;
  let detectionLayer: ProtocolDetectionLayer;
  let gateway: TrackerGatewayService;

  const mockPrisma = {} as any;
  const mockTrackingGateway = { broadcastToCompany: () => {} } as any;

  beforeEach(() => {
    registry = new GpsProtocolRegistry();
    detectionLayer = new ProtocolDetectionLayer(registry);
    gateway = new TrackerGatewayService(detectionLayer, mockPrisma, mockTrackingGateway);
  });

  it('registers built-in drivers on construction', () => {
    const driverNames = registry.getAllDrivers().map((d) => d.protocolName);
    expect(driverNames).toContain('GT06');
    expect(driverNames).toContain('TELTONIKA');
    expect(driverNames).toContain('TK103');
    expect(driverNames).toContain('H02');
  });

  it('detects GT06 protocol from a sample packet', () => {
    const driver = new Gt06Driver();
    const loginBody = Buffer.concat([
      Buffer.from([15]),
      Buffer.from('123456789012345', 'ascii'),
      Buffer.from([0x00, 0x00]),
    ]);
    const crcInput = Buffer.concat([Buffer.from([loginBody.length + 4]), Buffer.from([0x01]), loginBody]);
    const crc = crc16(crcInput);
    const crcBytes = Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);
    const stop = Buffer.from([0x0D, 0x0A]);
    const packet = Buffer.concat([Buffer.from([0x78, 0x78]), Buffer.from([loginBody.length + 4]), Buffer.from([0x01]), loginBody, crcBytes, stop]);

    expect(driver.canHandle(packet)).toBe(true);
    const imei = driver.extractImei(packet);
    expect(imei).toBe('123456789012345');
  });
});

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
