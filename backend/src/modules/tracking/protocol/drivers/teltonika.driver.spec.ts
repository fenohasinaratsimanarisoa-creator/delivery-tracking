import { TeltonikaDriver } from './teltonika.driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

describe('TeltonikaDriver', () => {
  let driver: TeltonikaDriver;

  beforeEach(() => {
    driver = new TeltonikaDriver();
  });

  it('has correct protocol name and transport', () => {
    expect(driver.protocolName).toBe(TrackerProtocol.TELTONIKA);
    expect(driver.transport).toBe('tcp');
    expect(driver.defaultPort).toBe(5056);
  });

  it('detects an IMEI packet', () => {
    const imei = '123456789012345';
    const packet = Buffer.alloc(1 + imei.length);
    packet[0] = imei.length;
    packet.write(imei, 1, imei.length, 'ascii');
    expect(driver.canHandle(packet)).toBe(true);
  });

  it('extracts IMEI from IMEI packet', () => {
    const imei = '123456789012345';
    const packet = Buffer.alloc(1 + imei.length);
    packet[0] = imei.length;
    packet.write(imei, 1, imei.length, 'ascii');
    expect(driver.extractImei(packet)).toBe(imei);
  });

  it('rejects non-Teltonika packets', () => {
    const packet = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(driver.canHandle(packet)).toBe(false);
  });

  it('parses a Codec 8 position packet', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const lat = -18.8792;
    const lng = 47.5079;

    const avlData = Buffer.alloc(24);
    avlData.writeUInt32BE(timestamp, 0);
    avlData[4] = 0;
    avlData.writeInt32BE(Math.round(lat * 10000000), 5);
    avlData.writeInt32BE(Math.round(lng * 10000000), 9);
    avlData.writeUInt16BE(1200, 13);
    avlData.writeUInt16BE(13500, 15);
    avlData[17] = 8;
    avlData.writeUInt16BE(3000, 18);

    const packet = Buffer.alloc(8 + 24 + 4);
    packet.writeUInt32BE(0, 0);
    packet[4] = 0x08;
    packet[5] = 1;
    packet[6] = 0;
    packet[7] = 0;
    avlData.copy(packet, 8);
    const crcOffset = 8 + 24;
    packet.writeUInt16BE(0, crcOffset);
    let crc = 0;
    for (let i = 4; i < packet.length - 2; i++) crc ^= packet[i];
    packet.writeUInt16BE(crc, crcOffset + 2);

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe(TrackerProtocol.TELTONIKA);
    expect(result!.latitude).toBeCloseTo(lat, 4);
    expect(result!.longitude).toBeCloseTo(lng, 4);
  });

  it('parses Codec 8 speed correctly (km/h * 100 → m/s)', () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const avlData = Buffer.alloc(24);
    avlData.writeUInt32BE(timestamp, 0);
    avlData[4] = 0;
    avlData.writeInt32BE(Math.round(-18.8792 * 10000000), 5);
    avlData.writeInt32BE(Math.round(47.5079 * 10000000), 9);
    avlData.writeUInt16BE(1200, 13);
    avlData.writeUInt16BE(13500, 15);
    avlData[17] = 8;
    avlData.writeUInt16BE(3600, 18);

    const packet = Buffer.alloc(8 + 24 + 4);
    packet.writeUInt32BE(0, 0);
    packet[4] = 0x08;
    packet[5] = 1;
    avlData.copy(packet, 8);
    let crc = 0;
    for (let i = 4; i < packet.length - 2; i++) crc ^= packet[i];
    packet.writeUInt16BE(crc, packet.length - 2);

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.speed).toBeCloseTo(10, 0);
  });

  it('returns capabilities', () => {
    const caps = driver.getCapabilities();
    expect(caps).toContain('gps');
    expect(caps).toContain('ignition');
    expect(caps).toContain('temperature');
  });
});
