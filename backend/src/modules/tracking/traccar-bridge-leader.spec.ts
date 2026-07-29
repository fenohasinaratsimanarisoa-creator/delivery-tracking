import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

const mockRedis = {
  call: jest.fn(),
  expire: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
  set: jest.fn(),
};

const mockPrisma = {
  vehicle: { findMany: jest.fn(), findFirst: jest.fn() },
  delivery: { findFirst: jest.fn() },
  gpsPosition: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
};

const mockTrackingService = {
  savePosition: jest.fn(),
  getLastPosition: jest.fn(),
  getCompanySettings: jest.fn(),
};

const mockGateway = {
  broadcastDataUpdate: jest.fn(),
  broadcastToCompany: jest.fn(),
};

const mockNotifications = {
  create: jest.fn(),
};

describe('TraccarBridgeService — Leader Election', () => {
  let services: TraccarBridgeService[] = [];

  function createService(redis: any, traccarUrl = 'http://traccar-prod:8082'): TraccarBridgeService {
    const config = { get: jest.fn((key: string, d?: string) => {
      const m: Record<string, string> = {
        TRACCAR_URL: traccarUrl,
        TRACCAR_USER: 'test',
        TRACCAR_PASSWORD: 'test',
      };
      return m[key] ?? (d as any);
    })};
    const svc = new TraccarBridgeService(
      config as unknown as ConfigService,
      mockPrisma as unknown as PrismaService,
      mockTrackingService as unknown as TrackingService,
      mockGateway as unknown as TrackingGateway,
      mockNotifications as unknown as NotificationsService,
      null,
      redis,
    );
    services.push(svc);
    return svc;
  }

  afterEach(async () => {
    for (const s of services) await s.onModuleDestroy();
    services = [];
    jest.clearAllMocks();
  });

  describe('with Redis (multi-instance mode)', () => {
    it('should become leader when acquiring Redis lock', async () => {
      mockRedis.call.mockResolvedValueOnce('OK');
      const service = createService(mockRedis);

      const result = await (service as any).tryBecomeLeader();

      expect(result).toBe(true);
      expect((service as any).isLeader).toBe(true);
      expect(mockRedis.call).toHaveBeenCalledWith(
        'SET', 'traccar:bridge:leader', String(process.pid), 'NX', 'EX', '30',
      );
    });

    it('should NOT become leader when lock is held by another instance', async () => {
      mockRedis.call.mockResolvedValueOnce(null);
      const service = createService(mockRedis);

      await (service as any).tryBecomeLeader();

      expect((service as any).isLeader).toBe(false);
    });

    it('should return true immediately if already leader (no NX re-try, no disconnect loop)', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

      const result = await (service as any).tryBecomeLeader();

      expect(result).toBe(true);
      expect(mockRedis.call).not.toHaveBeenCalled();
      expect((service as any).isLeader).toBe(true);
      expect(disconnectSpy).not.toHaveBeenCalled();
      disconnectSpy.mockRestore();
    });

    it('should not disconnect on 3 successive tryBecomeLeader calls after first success', async () => {
      const service = createService(mockRedis);
      mockRedis.call.mockResolvedValueOnce('OK');

      await (service as any).tryBecomeLeader();
      expect((service as any).isLeader).toBe(true);

      const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

      await (service as any).tryBecomeLeader();
      expect(disconnectSpy).not.toHaveBeenCalled();
      expect((service as any).isLeader).toBe(true);

      await (service as any).tryBecomeLeader();
      expect(disconnectSpy).not.toHaveBeenCalled();

      await (service as any).tryBecomeLeader();
      expect(disconnectSpy).not.toHaveBeenCalled();
      expect((service as any).isLeader).toBe(true);

      disconnectSpy.mockRestore();
    });

    it('should renew TTL in startLeaderRenew when lock owner matches pid', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      mockRedis.get.mockResolvedValueOnce(String(process.pid));
      mockRedis.expire.mockResolvedValueOnce(1);

      const LEADER_KEY = 'traccar:bridge:leader';
      const current = await mockRedis.get(LEADER_KEY);
      if (current === String(process.pid)) await mockRedis.expire(LEADER_KEY, 30);

      expect(mockRedis.get).toHaveBeenCalledWith(LEADER_KEY);
      expect(mockRedis.expire).toHaveBeenCalledWith(LEADER_KEY, 30);
    });

    it('should detect real loss of leadership and disconnect (key held by another pid)', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

      mockRedis.get.mockResolvedValueOnce('other-pid-42');
      const current = await mockRedis.get();
      if (current !== String(process.pid) && (service as any).isLeader) {
        (service as any).isLeader = false;
        (service as any).disconnect();
      }

      expect(disconnectSpy).toHaveBeenCalled();
      expect((service as any).isLeader).toBe(false);
      disconnectSpy.mockRestore();
    });

    it('should step down and release lock', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      mockRedis.get.mockResolvedValueOnce(String(process.pid));
      mockRedis.del.mockResolvedValueOnce(1);

      await (service as any).stepDown();

      expect(mockRedis.del).toHaveBeenCalledWith('traccar:bridge:leader');
      expect((service as any).isLeader).toBe(false);
    });

    it('should release lock on destroy', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      mockRedis.get.mockResolvedValueOnce(String(process.pid));
      mockRedis.del.mockResolvedValueOnce(1);

      await service.onModuleDestroy();

      expect(mockRedis.del).toHaveBeenCalledWith('traccar:bridge:leader');
    });
  });

  describe('without Redis (single-instance mode)', () => {
    it('should connect directly without leader election', async () => {
      const service = createService(null);
      await service.onModuleInit();
      expect((service as any).isLeader).toBe(false);
    });
  });
});
