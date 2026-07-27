import { GpsProtocolRegistry } from './gps-protocol-registry';
import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

class MockDriver implements GpsProtocolDriver {
  protocolName = TrackerProtocol.GT06;
  transport = 'tcp' as const;
  defaultPort = 5055;
  canHandle(rawPacket: Buffer): boolean {
    return rawPacket.length > 2 && rawPacket[0] === 0x78 && rawPacket[1] === 0x78;
  }
  parse(rawPacket: Buffer): any { return null; }
  encodeCommand(): Buffer | null { return null; }
  getCapabilities(): any[] { return ['gps']; }
  extractImei(): string | null { return null; }
}

class MockDriver2 implements GpsProtocolDriver {
  protocolName = TrackerProtocol.TK103;
  transport = 'tcp' as const;
  defaultPort = 5058;
  canHandle(rawPacket: Buffer): boolean {
    return rawPacket.length > 0 && rawPacket[0] === 0x68;
  }
  parse(): any { return null; }
  encodeCommand(): Buffer | null { return null; }
  getCapabilities(): any[] { return ['gps']; }
  extractImei(): string | null { return null; }
}

describe('GpsProtocolRegistry', () => {
  let registry: GpsProtocolRegistry;

  beforeEach(() => {
    registry = new GpsProtocolRegistry();
  });

  it('is empty on creation', () => {
    expect(registry.getAllDrivers()).toHaveLength(0);
  });

  it('registers a driver', () => {
    registry.register(new MockDriver());
    expect(registry.getAllDrivers()).toHaveLength(1);
  });

  it('retrieves a driver by protocol', () => {
    const driver = new MockDriver();
    registry.register(driver);
    expect(registry.getDriver(TrackerProtocol.GT06)).toBe(driver);
  });

  it('unregisters a driver', () => {
    registry.register(new MockDriver());
    registry.unregister(TrackerProtocol.GT06);
    expect(registry.getDriver(TrackerProtocol.GT06)).toBeUndefined();
  });

  it('detects driver by packet signature', () => {
    registry.register(new MockDriver());
    registry.register(new MockDriver2());

    const gt06Packet = Buffer.from([0x78, 0x78, 0x01, 0x02, 0x03]);
    const tk103Packet = Buffer.from([0x68, 0x01, 0x02, 0x03]);
    const unknownPacket = Buffer.from([0xFF, 0x01, 0x02]);

    expect(registry.detectDriver(gt06Packet)?.protocolName).toBe(TrackerProtocol.GT06);
    expect(registry.detectDriver(tk103Packet)?.protocolName).toBe(TrackerProtocol.TK103);
    expect(registry.detectDriver(unknownPacket)).toBeUndefined();
  });

  it('returns supported protocols list', () => {
    registry.register(new MockDriver());
    registry.register(new MockDriver2());
    const protocols = registry.getSupportedProtocols();
    expect(protocols).toContain(TrackerProtocol.GT06);
    expect(protocols).toContain(TrackerProtocol.TK103);
  });
});
