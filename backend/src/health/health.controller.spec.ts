import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  // Le constructeur du contrôleur ouvre sa propre connexion Redis/BullMQ si
  // REDIS_URL est défini — on la neutralise pendant ces tests unitaires (redis
  // et fuelQueue restent null, checks 'skipped') pour éviter les handles ouverts.
  const prevRedisUrl = process.env.REDIS_URL;
  beforeAll(() => {
    delete process.env.REDIS_URL;
  });
  afterAll(() => {
    if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
  });

  const makeController = (prisma: any) => new HealthController(prisma);

  it('renvoie 200 status=ok quand la DB répond et que redis/queue sont non configurés', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = makeController(prisma);
    (controller as any).checkRedis = jest.fn().mockResolvedValue({ status: 'skipped' });
    (controller as any).checkQueue = jest.fn().mockResolvedValue({ status: 'skipped' });
    const res = await controller.check();
    expect(res.status).toBe('ok');
    expect(res.checks.database.status).toBe('ok');
  });

  it('renvoie 200 status=degraded (JAMAIS 503) quand seule la file est en retard', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = makeController(prisma);
    (controller as any).checkQueue = jest
      .fn()
      .mockResolvedValue({ status: 'degraded', counts: { failed: 42 } });

    const res = await controller.check();
    expect(res.status).toBe('degraded');
    // Le point clé : pas d'exception → le load balancer garde l'instance en rotation.
  });

  it('renvoie 503 uniquement quand la base de données est injoignable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')) };
    await expect(makeController(prisma).check()).rejects.toBeInstanceOf(HttpException);
  });
});
