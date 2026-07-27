import { Tk103Driver } from './tk103.driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

describe('Tk103Driver', () => {
  let driver: Tk103Driver;

  beforeEach(() => {
    driver = new Tk103Driver();
  });

  it('detects TK103 packets by ( ) delimiters', () => {
    const packet = Buffer.from('(BP00123456789012345...)', 'ascii');
    expect(driver.canHandle(packet)).toBe(true);
  });

  it('parses a position string with coordinates', () => {
    const raw = '(BP00123456789012345BR00240701120000,A,1852.7520,S,04730.4740,E,25.0,135,V,1234,)';
    const packet = Buffer.from(raw, 'ascii');

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.protocol).toBe(TrackerProtocol.TK103);
    expect(result!.imei).toBe('123456789012345');
    expect(result!.latitude).toBeCloseTo(-18.8792, 2);
    expect(result!.longitude).toBeCloseTo(47.5079, 2);
  });

  it('parses speed correctly (knots to m/s)', () => {
    const raw = '(BP00123456789012345BR00240701120000,A,1852.7520,S,04730.4740,E,30.0,180,V,1234,)';
    const packet = Buffer.from(raw, 'ascii');

    const result = driver.parse(packet);
    expect(result).not.toBeNull();
    expect(result!.speed).toBeCloseTo(15.43, 1);
    expect(result!.heading).toBe(180);
  });

  it('returns null for packets without IMEI', () => {
    const raw = '(BP00BR00240701120000,A,1852.7520,S,04730.4740,E,25.0,135,V,1234,)';
    const packet = Buffer.from(raw, 'ascii');
    expect(driver.parse(packet)).toBeNull();
  });
});
