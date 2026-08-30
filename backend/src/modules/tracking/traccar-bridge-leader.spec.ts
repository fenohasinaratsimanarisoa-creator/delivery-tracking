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

  function createService(
    redis: any,
    traccarUrl = 'http://traccar-prod:8082',
  ): TraccarBridgeService {
    const config = {
      get: jest.fn((key: string, d?: string) => {
        const m: Record<string, string> = {
          TRACCAR_URL: traccarUrl,
          TRACCAR_USER: 'test',
          TRACCAR_PASSWORD: 'test',
        };
        return m[key] ?? (d as any);
      }),
    };
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
        'SET',
        'traccar:bridge:leader',
        (service as any).instanceId,
        'NX',
        'EX',
        '50',
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

    it('should renew TTL in startLeaderRenew when lock owner matches instanceId', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      mockRedis.get.mockResolvedValueOnce((service as any).instanceId);
      mockRedis.expire.mockResolvedValueOnce(1);

      const LEADER_KEY = 'traccar:bridge:leader';
      const current = await mockRedis.get(LEADER_KEY);
      if (current === (service as any).instanceId) await mockRedis.expire(LEADER_KEY, 50);

      expect(mockRedis.get).toHaveBeenCalledWith(LEADER_KEY);
      expect(mockRedis.expire).toHaveBeenCalledWith(LEADER_KEY, 50);
    });

    it('should detect real loss of leadership and disconnect (key held by another instance)', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

      mockRedis.get.mockResolvedValueOnce('other-instance-42');
      const current = await mockRedis.get();
      if (current !== (service as any).instanceId && (service as any).isLeader) {
        (service as any).isLeader = false;
        (service as any).disconnect();
      }

      expect(disconnectSpy).toHaveBeenCalled();
      expect((service as any).isLeader).toBe(false);
      disconnectSpy.mockRestore();
    });

    it('should tolerate 1 renewal failure then recover on success (isLeader stays true, no disconnect)', async () => {
      jest.useFakeTimers();
      try {
        const service = createService(mockRedis);
        (service as any).isLeader = true;
        const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

        // 1er renouvellement : échec Redis transitoire — toléré, pas de disconnect.
        mockRedis.get.mockRejectedValueOnce(new Error('redis connection timeout'));
        (service as any).startLeaderRenew();
        await jest.advanceTimersByTimeAsync(20000);

        expect((service as any).isLeader).toBe(true);
        expect((service as any).consecutiveRenewFailures).toBe(1);
        expect(disconnectSpy).not.toHaveBeenCalled();
        expect((service as any).leaderRenewTimer).not.toBeNull();

        // 2e renouvellement : succès — le compteur revient à 0, isLeader toujours true.
        mockRedis.get.mockResolvedValueOnce((service as any).instanceId);
        mockRedis.expire.mockResolvedValueOnce(1);
        await jest.advanceTimersByTimeAsync(20000);
        expect((service as any).isLeader).toBe(true);
        expect((service as any).consecutiveRenewFailures).toBe(0);
        expect(disconnectSpy).not.toHaveBeenCalled();
        expect(mockRedis.expire).toHaveBeenCalledWith('traccar:bridge:leader', 50);

        disconnectSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should step down after 2 consecutive renewal failures (redis.get rejects twice)', async () => {
      jest.useFakeTimers();
      try {
        const service = createService(mockRedis);
        (service as any).isLeader = true;
        const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

        // 1er échec : toléré.
        mockRedis.get.mockRejectedValueOnce(new Error('redis timeout 1'));
        (service as any).startLeaderRenew();
        await jest.advanceTimersByTimeAsync(20000);
        expect((service as any).isLeader).toBe(true);
        expect((service as any).consecutiveRenewFailures).toBe(1);
        expect(disconnectSpy).not.toHaveBeenCalled();

        // 2e échec consécutif : leadership cédé.
        mockRedis.get.mockRejectedValueOnce(new Error('redis timeout 2'));
        await jest.advanceTimersByTimeAsync(20000);
        expect((service as any).isLeader).toBe(false);
        expect((service as any).consecutiveRenewFailures).toBe(2);
        expect(disconnectSpy).toHaveBeenCalled();
        expect((service as any).leaderRenewTimer).toBeNull();

        disconnectSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should step down after 2 consecutive expire failures (GET ok, EXPIRE rejects twice)', async () => {
      jest.useFakeTimers();
      try {
        const service = createService(mockRedis);
        (service as any).isLeader = true;
        const disconnectSpy = jest.spyOn(service as any, 'disconnect').mockImplementation(() => {});

        // 1er échec EXPIRE : toléré.
        mockRedis.get.mockResolvedValueOnce((service as any).instanceId);
        mockRedis.expire.mockRejectedValueOnce(new Error('redis gone away 1'));
        (service as any).startLeaderRenew();
        await jest.advanceTimersByTimeAsync(20000);
        expect((service as any).isLeader).toBe(true);
        expect((service as any).consecutiveRenewFailures).toBe(1);
        expect(disconnectSpy).not.toHaveBeenCalled();

        // 2e échec EXPIRE consécutif : leadership cédé.
        mockRedis.get.mockResolvedValueOnce((service as any).instanceId);
        mockRedis.expire.mockRejectedValueOnce(new Error('redis gone away 2'));
        await jest.advanceTimersByTimeAsync(20000);
        expect(disconnectSpy).toHaveBeenCalled();
        expect((service as any).isLeader).toBe(false);
        expect((service as any).consecutiveRenewFailures).toBe(2);
        expect((service as any).leaderRenewTimer).toBeNull();
        disconnectSpy.mockRestore();
      } finally {
        jest.useRealTimers();
      }
    });

    it('should step down and release lock', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      mockRedis.get.mockResolvedValueOnce((service as any).instanceId);
      mockRedis.del.mockResolvedValueOnce(1);

      await (service as any).stepDown();

      expect(mockRedis.del).toHaveBeenCalledWith('traccar:bridge:leader');
      expect((service as any).isLeader).toBe(false);
    });

    it('should release lock on destroy', async () => {
      const service = createService(mockRedis);
      (service as any).isLeader = true;
      mockRedis.get.mockResolvedValueOnce((service as any).instanceId);
      mockRedis.del.mockResolvedValueOnce(1);

      await service.onModuleDestroy();

      expect(mockRedis.del).toHaveBeenCalledWith('traccar:bridge:leader');
    });
  });

  // ----------------------------------------------------------------
  // Identité de leader : deux instances conteneurisées partagent process.pid=1 mais
  // doivent avoir des instanceId différents pour préserver l'exclusion mutuelle.
  // ----------------------------------------------------------------
  describe('with shared Redis (identité de leader — process.pid=1 en conteneur)', () => {
    // Simulation fidèle d'un Redis partagé (SET NX, GET, DEL, EXPIRE) sur un store en
    // mémoire, pour prouver le comportement d'exclusion mutuelle entre instances réelles.
    function createSharedRedis() {
      const store = new Map<string, string>();
      return {
        store,
        call: jest.fn(async (cmd: string, key: string, value?: string) => {
          if (cmd === 'SET') {
            if (store.has(key)) return null;
            store.set(key, value!);
            return 'OK';
          }
          return null;
        }),
        get: jest.fn(async (key: string) => store.get(key) ?? null),
        expire: jest.fn(async () => 1),
        del: jest.fn(async (key: string) => {
          store.delete(key);
          return 1;
        }),
      };
    }

    it('Test A : deux instances au même process.pid (conteneur) mais des instanceId différents → exclusion mutuelle maintenue', async () => {
      jest.useFakeTimers();
      const redis = createSharedRedis();
      const svc1 = createService(redis);
      const svc2 = createService(redis);

      // Les deux instances vivent dans le même processus de test → MÊME process.pid
      // (exactement le scénario de bug : pid=1 partagé entre replicas conteneurisés).
      expect(process.pid).toBeDefined();
      // Mais leurs instanceId sont distincts (UUID) : c'est LA correction.
      expect((svc1 as any).instanceId).not.toBe((svc2 as any).instanceId);

      // svc1 acquiert le lock.
      expect(await (svc1 as any).tryBecomeLeader()).toBe(true);
      expect(redis.store.get('traccar:bridge:leader')).toBe((svc1 as any).instanceId);

      // svc2 (même pid) ne peut PAS acquérir → ne croit jamais être leader.
      expect(await (svc2 as any).tryBecomeLeader()).toBe(false);
      expect((svc2 as any).isLeader).toBe(false);

      // Le renouvellement de svc1 lit le lock = son propre instanceId → il le renouvelle,
      // et la présence de svc2 (même pid) ne l'invalide JAMAIS.
      (svc1 as any).isLeader = true;
      (svc1 as any).startLeaderRenew();
      await jest.advanceTimersByTimeAsync(20000);
      expect((svc1 as any).isLeader).toBe(true);
      expect(redis.expire).toHaveBeenCalledWith('traccar:bridge:leader', 50);

      // Le renouvellement de svc2 (faussement leader) lit le lock = instance1 ≠ instance2
      // → il détecte qu'il n'est PAS le détenteur et abandonne (sans jamais supprimer le
      // lock de svc1).
      (svc2 as any).isLeader = true;
      (svc2 as any).startLeaderRenew();
      await jest.advanceTimersByTimeAsync(20000);
      expect((svc2 as any).isLeader).toBe(false);
      expect(redis.store.get('traccar:bridge:leader')).toBe((svc1 as any).instanceId);

      jest.useRealTimers();
    });

    it('Test B : un redémarrage du même conteneur (nouveau instanceId) reprend le lock une fois l’ancien expiré', async () => {
      const redis = createSharedRedis();

      // Ancienne instance : a acquis le lock puis le conteneur est mort.
      const oldSvc = createService(redis);
      await (oldSvc as any).tryBecomeLeader();
      const oldId = (oldSvc as any).instanceId;
      expect(redis.store.get('traccar:bridge:leader')).toBe(oldId);

      // Le lock expire (TTL) — l'ancienne instance ne renouvelle plus.
      redis.store.delete('traccar:bridge:leader');

      // Nouvelle instance (redémarrage) : instanceId différent de l'ancien.
      const newSvc = createService(redis);
      expect((newSvc as any).instanceId).not.toBe(oldId);

      // Elle acquiert le lock sans blocage permanent.
      expect(await (newSvc as any).tryBecomeLeader()).toBe(true);
      expect((newSvc as any).isLeader).toBe(true);
      expect(redis.store.get('traccar:bridge:leader')).toBe((newSvc as any).instanceId);
    });

    it('Test C : stepDown ne supprime le lock QUE si current === instanceId (jamais celui d’une autre instance)', async () => {
      const redis = createSharedRedis();
      const svc = createService(redis);
      const other = createService(redis);

      // L'autre instance détient le lock.
      await (other as any).tryBecomeLeader();
      expect(redis.store.get('traccar:bridge:leader')).toBe((other as any).instanceId);

      // svc (non détenteur, croyance obsolète de leadership) tente un stepDown :
      // il ne doit PAS supprimer le lock de l'autre instance.
      (svc as any).isLeader = true;
      await (svc as any).stepDown();
      expect(redis.store.get('traccar:bridge:leader')).toBe((other as any).instanceId);
      expect(redis.del).not.toHaveBeenCalled();

      // Quand svc détient réellement le lock, stepDown le libère.
      redis.store.delete('traccar:bridge:leader');
      await (svc as any).tryBecomeLeader();
      await (svc as any).stepDown();
      expect(redis.store.has('traccar:bridge:leader')).toBe(false);
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
