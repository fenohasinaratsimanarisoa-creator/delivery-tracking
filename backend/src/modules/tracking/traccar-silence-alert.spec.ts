import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

// =============================================================================
// ALERTE « TRACEUR HORS LIGNE » (audit 2026-09-20) : 968 alertes en 14 jours (99,7 % des
// notifications), une toutes les 15-16 min, alors que le traceur est déclenché par le
// mouvement et se TAIT quand le véhicule est garé. Nouvelle règle : alerter seulement si le
// silence survient pendant une livraison en cours (< 24 h) ou si le dernier fix était en
// pleine vitesse, et UNE SEULE fois par silence.
// =============================================================================

const VEHICLE = {
  id: 'vehicle-1',
  companyId: 'c1',
  traccarDeviceId: '1',
  driver: { id: 'd1', userId: 'u1' },
};

describe('TraccarBridgeService — alerte de silence du traceur', () => {
  let service: TraccarBridgeService;
  let prisma: any;
  let tracking: any;
  let notifications: any;
  let redis: any;

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  beforeEach(() => {
    prisma = {
      vehicle: { findMany: jest.fn().mockResolvedValue([VEHICLE]), findFirst: jest.fn() },
      delivery: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    tracking = {
      getLastPosition: jest.fn(),
      getCompanySettings: jest.fn().mockResolvedValue({ offlineTimeoutMinutes: 15 }),
    };
    notifications = { create: jest.fn().mockResolvedValue({ id: 'n1' }) };
    redis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue('OK'),
      set: jest.fn(),
      del: jest.fn(),
      lpush: jest.fn(),
      ltrim: jest.fn(),
      lrange: jest.fn(),
      lrem: jest.fn(),
      llen: jest.fn(),
      call: jest.fn(),
      expire: jest.fn(),
    };
    const config = {
      get: jest.fn(
        (key: string, d?: string) =>
          ({ TRACCAR_URL: 'http://traccar:8082', TRACCAR_USER: 'u', TRACCAR_PASSWORD: 'p' })[key] ??
          d,
      ),
    };
    service = new TraccarBridgeService(
      config as unknown as ConfigService,
      prisma as PrismaService,
      tracking as TrackingService,
      {
        broadcastDataUpdate: jest.fn(),
        broadcastToCompany: jest.fn(),
      } as unknown as TrackingGateway,
      notifications as NotificationsService,
      null,
      redis,
    );
  });

  const check = () => (service as any).checkSilentPhysicalDevices();
  const lastFix = (min: number, speed: number) => ({
    timestamp: minutesAgo(min),
    speed,
    latitude: -18.86,
    longitude: 47.56,
    attributes: {},
  });

  it('moto GARÉE (dernier fix à vitesse nulle), aucune livraison : AUCUNE alerte, même après des heures', async () => {
    tracking.getLastPosition.mockResolvedValue(lastFix(180, 0));
    await check();
    await check();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('livraison en cours + silence > 15 min : UNE alerte, et pas de nouvelle alerte pour le même silence', async () => {
    tracking.getLastPosition.mockResolvedValue(lastFix(20, 0));
    prisma.delivery.findFirst.mockResolvedValue({ id: 'del-1' });
    await check();
    await check();
    await check();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(notifications.create.mock.calls[0][1].title).toBe('Traceur physique hors ligne');
  });

  it("l'alerte est UNIQUE par silence même si Redis est indisponible (mémoire du service)", async () => {
    (service as any).redis = null;
    tracking.getLastPosition.mockResolvedValue(lastFix(30, 0));
    prisma.delivery.findFirst.mockResolvedValue({ id: 'del-1' });
    await check();
    await check();
    expect(notifications.create).toHaveBeenCalledTimes(1);
  });

  it('dernier fix en pleine vitesse (8 m/s) : alerte même sans livraison (traceur perdu en roulant)', async () => {
    tracking.getLastPosition.mockResolvedValue(lastFix(20, 8));
    await check();
    expect(notifications.create).toHaveBeenCalledTimes(1);
    expect(prisma.delivery.findFirst).not.toHaveBeenCalled();
  });

  it('un NOUVEAU silence (nouveau dernier fix) déclenche une nouvelle alerte', async () => {
    prisma.delivery.findFirst.mockResolvedValue({ id: 'del-1' });
    tracking.getLastPosition.mockResolvedValue(lastFix(30, 0));
    await check();
    tracking.getLastPosition.mockResolvedValue(lastFix(20, 0)); // le traceur a repris, puis s'est retaiu
    await check();
    expect(notifications.create).toHaveBeenCalledTimes(2);
  });

  it('silence de moins de 15 min : aucune alerte', async () => {
    tracking.getLastPosition.mockResolvedValue(lastFix(10, 8));
    prisma.delivery.findFirst.mockResolvedValue({ id: 'del-1' });
    await check();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('seule une livraison en cours créée il y a moins de 24 h compte (les livraisons oubliées sont ignorées)', async () => {
    tracking.getLastPosition.mockResolvedValue(lastFix(60, 0));
    await check();
    const where = prisma.delivery.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe('in_progress');
    expect(where.vehicleId).toBe('vehicle-1');
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    const ageH = (Date.now() - where.createdAt.gte.getTime()) / 3_600_000;
    expect(ageH).toBeGreaterThan(23.9);
    expect(ageH).toBeLessThan(24.1);
  });

  it('verrou Redis lié au DERNIER fix (24 h) : un silence déjà alerté est ignoré après redémarrage du service', async () => {
    tracking.getLastPosition.mockResolvedValue(lastFix(25, 8));
    await check();
    const key = redis.setex.mock.calls[0][0] as string;
    expect(key).toMatch(/^silent_alert:vehicle-1:\d+$/);
    expect(redis.setex.mock.calls[0][1]).toBe(24 * 60 * 60);

    // « redémarrage » : mémoire vide mais Redis conserve le verrou
    (service as any).silentAlerted.clear();
    redis.get.mockResolvedValue('1');
    notifications.create.mockClear();
    await check();
    expect(notifications.create).not.toHaveBeenCalled();
  });
  describe('traceur endormi mais joignable (paquets de veille) — audit trajets 2026-09-21', () => {
    const realFetch = global.fetch;
    const devices = (lastUpdateMinAgo: number | null) =>
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 1,
            status: 'online',
            lastUpdate:
              lastUpdateMinAgo == null ? null : minutesAgo(lastUpdateMinAgo).toISOString(),
          },
        ],
      });
    beforeEach(() => {
      (service as any).sessionCookie = 'JSESSIONID=x';
    });
    afterEach(() => {
      global.fetch = realFetch;
    });

    it('cas réel du 24/09 : dernier fix à 15 km/h puis silence, veille reçue il y a 2 min → AUCUNE alerte', async () => {
      global.fetch = devices(2) as any;
      tracking.getLastPosition.mockResolvedValue(lastFix(16, 4));
      await check();
      expect(notifications.create).not.toHaveBeenCalled();
    });

    it('la veille s’arrête pendant le même silence : le passage suivant alerte', async () => {
      global.fetch = devices(2) as any;
      tracking.getLastPosition.mockResolvedValue(lastFix(16, 4));
      await check();
      global.fetch = devices(20) as any;
      await check();
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it('livraison en cours, traceur injoignable (dernier contact > seuil) : alerte', async () => {
      global.fetch = devices(40) as any;
      prisma.delivery.findFirst.mockResolvedValue({ id: 'del-1' });
      tracking.getLastPosition.mockResolvedValue(lastFix(40, 0));
      await check();
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it('Traccar indisponible : règle d’avant (alerte)', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as any;
      tracking.getLastPosition.mockResolvedValue(lastFix(20, 8));
      await check();
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });

    it('une seule requête Traccar par passage, même avec plusieurs véhicules silencieux', async () => {
      const f = devices(2);
      global.fetch = f as any;
      prisma.vehicle.findMany.mockResolvedValue([
        VEHICLE,
        { ...VEHICLE, id: 'vehicle-2', traccarDeviceId: '2' },
      ]);
      tracking.getLastPosition.mockResolvedValue(lastFix(20, 8));
      await check();
      expect(f).toHaveBeenCalledTimes(1);
      // vehicle-2 (device 2) absent de Traccar → alerte ; vehicle-1 joignable → rien
      expect(notifications.create).toHaveBeenCalledTimes(1);
    });
  });
});
