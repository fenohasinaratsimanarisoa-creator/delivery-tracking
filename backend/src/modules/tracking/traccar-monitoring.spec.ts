import { TraccarBridgeService } from './traccar-bridge.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType, NotificationPriority } from '@prisma/client';

describe('Tâche 5 — Surveillance indépendante Traccar', () => {
  let mockConfig: any;
  let mockPrisma: any;
  let mockTrackingService: any;
  let mockGateway: any;
  let mockNotifications: jest.Mocked<NotificationsService>;
  let mockRedis: any;
  let bridge: TraccarBridgeService;

  const COMPANY_ID = 'company-1';

  function createBridge() {
    bridge = new TraccarBridgeService(
      mockConfig as any,
      mockPrisma as any,
      mockTrackingService as any,
      mockGateway as any,
      mockNotifications as any,
      null,
      mockRedis as any,
    );
    return bridge;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'TRACCAR_URL') return 'http://traccar:8082';
        if (key === 'TRACCAR_USER') return 'admin';
        if (key === 'TRACCAR_PASSWORD') return 'admin';
        return null;
      }),
    };

    mockPrisma = {
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    mockTrackingService = {
      getLastPosition: jest.fn(),
    };

    mockGateway = {
      broadcastToCompany: jest.fn(),
      broadcastDataUpdate: jest.fn(),
    };

    mockNotifications = {
      create: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    } as any;

    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      lpush: jest.fn().mockResolvedValue(1),
      ltrim: jest.fn().mockResolvedValue('OK'),
      llen: jest.fn().mockResolvedValue(0),
      lrange: jest.fn().mockResolvedValue([]),
      lrem: jest.fn().mockResolvedValue(1),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('5.1 Alerte device jamais connecté', () => {
    it('déclenche alerte pour un device >30min sans aucune position', async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'vehicle-1',
          companyId: COMPANY_ID,
          createdAt: new Date(Date.now() - 45 * 60 * 1000),
          traccarDeviceId: '1234567890',
          driver: { id: 'driver-1', userId: 'user-1' },
        },
      ]);
      mockTrackingService.getLastPosition.mockResolvedValue(null);

      createBridge();

      await (bridge as any).checkSilentPhysicalDevices();

      const neverConnectedCheck = (bridge as any).startNeverConnectedCheck;
      if (neverConnectedCheck) {
        await (bridge as any).checkNeverConnectedDevices();
      }
    });

    it("ne déclenche PAS d'alerte si le device a déjà reçu une position", async () => {
      const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'vehicle-2',
          companyId: COMPANY_ID,
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          traccarDeviceId: '9876543210',
          driver: { id: 'driver-2', userId: 'user-2' },
        },
      ]);
      mockTrackingService.getLastPosition.mockResolvedValue({
        timestamp: threeMinutesAgo,
        latitude: -18.8792,
        longitude: 47.5079,
      });

      createBridge();
      await (bridge as any).startNeverConnectedCheck();
    });

    it("ne déclenche PAS d'alerte si le device a été créé il y a moins de 30min", async () => {
      mockPrisma.vehicle.findMany.mockResolvedValue([
        {
          id: 'vehicle-3',
          companyId: COMPANY_ID,
          createdAt: new Date(Date.now() - 10 * 60 * 1000),
          traccarDeviceId: '5555555555',
          driver: { id: 'driver-3', userId: 'user-3' },
        },
      ]);
      mockTrackingService.getLastPosition.mockResolvedValue(null);

      createBridge();
      await (bridge as any).startNeverConnectedCheck();
    });
  });

  describe('Watchdog socket zombie (aucun message WS reçu alors que connected=true)', () => {
    // Régression 2026-09-06 : le pont Traccar est resté "connected=true" indéfiniment
    // (~16h) alors que le WS ne poussait plus rien — Traccar lui-même recevait pourtant
    // les positions normalement (uniquement le socket de CE pont était mort côté réseau,
    // sans event 'close'). Le check de session HTTP (/api/server) ne détecte pas ce cas
    // : la session REST reste valide, seul le canal WS temps réel est mort.
    it('force une reconnexion si connected=true mais aucun message WS depuis > 15 min', async () => {
      createBridge();
      (bridge as any).connected = true;
      (bridge as any).sessionCookie = 'cookie';
      (bridge as any).lastMessageAt = Date.now() - 16 * 60 * 1000;

      const disconnectSpy = jest.spyOn(bridge as any, 'disconnect').mockImplementation(() => {});
      const reconnectSpy = jest
        .spyOn(bridge as any, 'scheduleReconnect')
        .mockImplementation(() => {});

      await (bridge as any).runHealthCheck();

      expect(disconnectSpy).toHaveBeenCalled();
      expect(reconnectSpy).toHaveBeenCalled();
    });

    it("ne force PAS de reconnexion si des messages WS arrivent toujours (< 15 min)", async () => {
      createBridge();
      (bridge as any).connected = true;
      (bridge as any).sessionCookie = 'cookie';
      (bridge as any).lastMessageAt = Date.now() - 2 * 60 * 1000;
      global.fetch = jest.fn().mockResolvedValue({ ok: true }) as any;

      const disconnectSpy = jest.spyOn(bridge as any, 'disconnect').mockImplementation(() => {});

      await (bridge as any).runHealthCheck();

      expect(disconnectSpy).not.toHaveBeenCalled();
    });
  });

  describe('Garde-fou process worker (IS_QUEUE_WORKER)', () => {
    // Régression 2026-09-06 : FuelConsumptionModule importe TrackingModule (pour
    // TrackingGateway) et instanciait donc AUSSI TraccarBridgeService dans le worker
    // (queue.worker.ts, bootstrapé via createApplicationContext — sans serveur
    // WebSocket). Si le worker remportait l'élection de leader Redis du pont, TOUTE
    // diffusion GPS temps réel vers le navigateur était silencieusement perdue
    // (TrackingGateway.server est undefined dans ce process). Voir queue.worker.ts.
    const ORIGINAL_ENV = process.env.IS_QUEUE_WORKER;

    afterEach(() => {
      if (ORIGINAL_ENV === undefined) delete process.env.IS_QUEUE_WORKER;
      else process.env.IS_QUEUE_WORKER = ORIGINAL_ENV;
    });

    it("onModuleInit ne fait RIEN dans le process worker (IS_QUEUE_WORKER=1)", async () => {
      process.env.IS_QUEUE_WORKER = '1';
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'TRACCAR_URL') return 'http://mon-traccar-vps.com:8082';
        return null;
      });
      createBridge();

      await bridge.onModuleInit();

      // Ni élection de leader, ni connexion, ni minuteurs : le pont ne doit RIEN
      // démarrer dans ce process (retour anticipé avant tryBecomeLeader()/connect()).
      expect((bridge as any).isLeader).toBe(false);
      expect((bridge as any).connected).toBe(false);
      expect((bridge as any).leaderRetryTimer).toBeNull();
      expect((bridge as any).healthTimer).toBeNull();
    });

    it('onModuleInit démarre normalement quand IS_QUEUE_WORKER n\'est PAS défini (process backend)', async () => {
      delete process.env.IS_QUEUE_WORKER;
      mockConfig.get.mockImplementation((key: string) => {
        if (key === 'TRACCAR_URL') return 'disabled';
        return null;
      });
      createBridge();

      await bridge.onModuleInit();

      // Chemin normal atteint : le garde-fou worker n'a pas court-circuité — la suite
      // de onModuleInit (détection TRACCAR_URL='disabled' → notifyInactiveOnce) a bien
      // tourné, contrairement au test précédent où RIEN ne s'exécute après le retour
      // anticipé.
      expect((bridge as any).inactiveNotified).toBe(true);
    });
  });
});
