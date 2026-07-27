import { H02Driver } from './h02.driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

describe('H02Driver', () => {
  let driver: H02Driver;

  beforeEach(() => {
    driver = new H02Driver();
  });

  it('detects H02 packets by $ ... # delimiters', () => {
    const packet = Buffer.from('$IM123456789012345...V1852.7520,S,04730.4740,E,25.0,135,123456#', 'ascii');
    expect(driver.canHandle(packet)).toBe(true);
  });

  it('parses a position string with coordinates', () => {
    const raw = '$IM123456789012345,V1852.7520,S,04730.4740,E,25.0,135,123456#';
    const packet = Buffer.from(raw, 'ascii');

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe(TrackerProtocol.H02);
    expect(result!.imei).toBe('123456789012345');
    expect(result!.latitude).toBeCloseTo(-18.8792, 2);
    expect(result!.longitude).toBeCloseTo(47.5079, 2);
  });

  it('extracts IMEI from packet', () => {
    const raw = '$IM123456789012345,...#';
    const packet = Buffer.from(raw, 'ascii');
    expect(driver.extractImei(packet)).toBe('123456789012345');
  });
});
