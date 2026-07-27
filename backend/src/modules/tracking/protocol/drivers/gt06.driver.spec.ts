import { Gt06Driver } from './gt06.driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

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

function buildGt06Packet(protocolNum: number, body: Buffer): Buffer {
  const crcInput = Buffer.concat([Buffer.from([body.length + 4]), Buffer.from([protocolNum]), body]);
  const crc = crc16(crcInput);
  const crcBytes = Buffer.from([(crc >> 8) & 0xFF, crc & 0xFF]);
  const stop = Buffer.from([0x0D, 0x0A]);
  return Buffer.concat([Buffer.from([0x78, 0x78]), Buffer.from([body.length + 4]), Buffer.from([protocolNum]), body, crcBytes, stop]);
}

describe('Gt06Driver', () => {
  let driver: Gt06Driver;

  beforeEach(() => {
    driver = new Gt06Driver();
  });

  it('has correct protocol name and transport', () => {
    expect(driver.protocolName).toBe(TrackerProtocol.GT06);
    expect(driver.transport).toBe('tcp');
    expect(driver.defaultPort).toBe(5055);
  });

  it('detects GT06 packets by header signature 0x7878', () => {
    const packet = buildGt06Packet(0x12, Buffer.alloc(20));
    expect(driver.canHandle(packet)).toBe(true);
  });

  it('rejects non-GT06 packets', () => {
    const packet = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x0D, 0x0A]);
    expect(driver.canHandle(packet)).toBe(false);
  });

  it('rejects malformed packets (wrong CRC)', () => {
    const body = Buffer.alloc(20, 0x00);
    body[0] = 0x12;
    const crcInput = Buffer.concat([Buffer.from([24]), Buffer.from([0x12]), body]);
    const crc = crc16(crcInput);
    const crcBytes = Buffer.from([(crc >> 8) & 0xFF, (crc & 0xFF) ^ 0xFF]);
    const stop = Buffer.from([0x0D, 0x0A]);
    const malformed = Buffer.concat([Buffer.from([0x78, 0x78]), Buffer.from([24]), Buffer.from([0x12]), body, crcBytes, stop]);
    expect(driver.parse(malformed)).toBeNull();
  });

  it('parses a valid GPS position packet with correct lat/lng', () => {
    const lat = -18.8792;
    const lng = 47.5079;
    const latVal = Math.round(Math.abs(lat) * 1000000);
    const lngVal = Math.round(Math.abs(lng) * 1000000);

    const latBytes = Buffer.alloc(4);
    latBytes.writeUInt32BE(latVal, 0);
    latBytes[0] |= 0x80;

    const lngBytes = Buffer.alloc(4);
    lngBytes.writeUInt32BE(lngVal, 0);

    const dateStr = '240701120000';
    const body = Buffer.concat([
      Buffer.from(dateStr, 'ascii'),
      Buffer.alloc(6),
      latBytes,
      lngBytes,
      Buffer.from([0x00, 0x32]),
      Buffer.from([0x00, 0x87]),
      Buffer.from([0x04, 0x00]),
      Buffer.alloc(4),
      Buffer.from([0x00, 0x00]),
      Buffer.alloc(2),
    ]);

    const packet = buildGt06Packet(0x12, body);

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe(TrackerProtocol.GT06);
    expect(result!.latitude).toBeCloseTo(-18.8792, 3);
    expect(result!.longitude).toBeCloseTo(47.5079, 3);
    expect(result!.heading).toBe(135);
  });

  it('detects alarm packets (SOS)', () => {
    const dateStr = '240701120000';
    const body = Buffer.concat([
      Buffer.from(dateStr, 'ascii'),
      Buffer.alloc(6),
      Buffer.alloc(4),
      Buffer.alloc(4),
      Buffer.from([0x00, 0x32]),
      Buffer.from([0x00, 0x87]),
      Buffer.from([0x04, 0x00]),
      Buffer.alloc(4),
      Buffer.from([0x00, 0x00]),
      Buffer.alloc(2),
    ]);

    const packet = buildGt06Packet(0x16, body);

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.alarms).toContain('sos');
  });

  it('extracts IMEI from login packet', () => {
    const imei = '123456789012345';
    const body = Buffer.concat([
      Buffer.from([imei.length]),
      Buffer.from(imei, 'ascii'),
      Buffer.from([0x00, 0x00]),
    ]);
    const packet = buildGt06Packet(0x01, body);

    const extracted = driver.extractImei(packet);
    expect(extracted).toBe(imei);
  });

  it('encodes a reboot command', () => {
    const cmd = driver.encodeCommand({ command: 'reboot' });
    expect(cmd).not.toBeNull();
    expect(cmd!.toString()).toBe('reboot');
  });

  it('encodes a set_interval command', () => {
    const cmd = driver.encodeCommand({ command: 'set_interval', parameters: { intervalSeconds: 30 } });
    expect(cmd).not.toBeNull();
    expect(cmd!.toString()).toBe('upload,30');
  });

  it('encodes a set_apn command', () => {
    const cmd = driver.encodeCommand({ command: 'set_apn', parameters: { apn: 'telma' } });
    expect(cmd).not.toBeNull();
    expect(cmd!.toString()).toBe('apn,telma');
  });

  it('returns null for unsupported commands', () => {
    const cmd = driver.encodeCommand({ command: 'cut_engine' as any });
    expect(cmd).toBeNull();
  });
});
