import { TrackerSecurityService } from './tracker-security.service';
import { TrackerDeviceService } from '../tracker-device.service';
import { GpsProtocolRegistry } from '../registry/gps-protocol-registry';
import { UnifiedGpsEvent, TrackerProtocol } from '../interfaces/unified-gps-event';

describe('TrackerSecurityService', () => {
  let mockDeviceService: any;
  let registry: GpsProtocolRegistry;
  let security: TrackerSecurityService;

  beforeEach(() => {
    registry = new GpsProtocolRegistry();
    mockDeviceService = { findByImei: jest.fn() };
    security = new TrackerSecurityService(mockDeviceService as any);
  });

  describe('authenticate', () => {
    it('rejects invalid IMEI (too short)', async () => {
      const result = await security.authenticate('123');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('IMEI');
    });

    it('rejects unknown IMEI', async () => {
      mockDeviceService.findByImei.mockResolvedValue(null);
      const result = await security.authenticate('123456789012345');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('non enregistré');
    });

    it('rejects inactive device', async () => {
      mockDeviceService.findByImei.mockResolvedValue({ isActive: false, vehicleId: 'v-1' });
      const result = await security.authenticate('123456789012345');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('désactivé');
    });

    it('rejects device not linked to vehicle', async () => {
      mockDeviceService.findByImei.mockResolvedValue({ isActive: true, vehicleId: null });
      const result = await security.authenticate('123456789012345');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('non lié');
    });

    it('accepts a valid active linked device', async () => {
      mockDeviceService.findByImei.mockResolvedValue({ isActive: true, vehicleId: 'v-1' });
      const result = await security.authenticate('123456789012345');
      expect(result.allowed).toBe(true);
    });
  });

  describe('checkRateLimit', () => {
    it('allows first request', async () => {
      const result = await security.checkRateLimit('imei-1');
      expect(result.allowed).toBe(true);
    });

    it('rejects after 10 requests in 1 second', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await security.checkRateLimit('imei-2')).allowed).toBe(true);
      }
      const result = await security.checkRateLimit('imei-2');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit');
    });
  });

  describe('validateEvent', () => {
    const makeEvent = (overrides: Partial<UnifiedGpsEvent> = {}): UnifiedGpsEvent => ({
      deviceId: 'd-1', imei: '123456789012345', protocol: TrackerProtocol.GT06,
      latitude: -18.8792, longitude: 47.5079, timestamp: new Date(),
      ...overrides,
    });

    it('accepts valid event', () => {
      expect(security.validateEvent(makeEvent()).allowed).toBe(true);
    });

    it('rejects NaN latitude', () => {
      expect(security.validateEvent(makeEvent({ latitude: NaN })).allowed).toBe(false);
    });

    it('rejects out-of-range latitude', () => {
      expect(security.validateEvent(makeEvent({ latitude: 100 })).allowed).toBe(false);
    });

    it('rejects null coordinates (0,0)', () => {
      expect(security.validateEvent(makeEvent({ latitude: 0, longitude: 0 })).allowed).toBe(false);
    });

    it('rejects invalid speed', () => {
      expect(security.validateEvent(makeEvent({ speed: 999 })).allowed).toBe(false);
    });

    it('rejects invalid timestamp', () => {
      expect(security.validateEvent(makeEvent({ timestamp: new Date('invalid') })).allowed).toBe(false);
    });
  });
});
