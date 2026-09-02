import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { CsrfContext, fetchCsrf, withCsrf } from './helpers/csrf';

/**
 * Contrôle d'accès de bout en bout — RBAC, clés API scopées, validation SSRF
 * des webhooks. Ces chemins ne sont couverts que par des tests unitaires isolés ;
 * ici on vérifie le comportement HTTP réel (guards + pipe + service + Prisma).
 */
describe('Authorization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let csrf: CsrfContext;

  let companyId: string;
  let adminToken: string;
  let driverToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const company = await prisma.company.create({ data: { name: 'AuthZ E2E Co' } });
    companyId = company.id;

    const passwordHash = await bcrypt.hash('StrongPass123', 1);
    await prisma.user.createMany({
      data: [
        {
          email: 'authz-admin@test.com',
          passwordHash,
          firstName: 'Ada',
          lastName: 'Admin',
          role: 'admin',
          companyId,
        },
        {
          email: 'authz-driver@test.com',
          passwordHash,
          firstName: 'Dan',
          lastName: 'Driver',
          role: 'driver',
          companyId,
        },
      ],
    });

    const login = (email: string) =>
      request(app.getHttpServer()).post('/auth/login').send({ email, password: 'StrongPass123' });

    adminToken = (await login('authz-admin@test.com').expect(200)).body.accessToken;
    driverToken = (await login('authz-driver@test.com').expect(200)).body.accessToken;
    csrf = await fetchCsrf(app);
  }, 20000);

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { companyId } });
    await prisma.webhook.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  describe('RBAC — endpoints réservés', () => {
    it('refuse un accès non authentifié (401)', async () => {
      await request(app.getHttpServer()).get('/vehicles').expect(401);
    });

    it('un chauffeur ne peut pas créer un véhicule (403, réservé admin/dispatcher)', async () => {
      await withCsrf(
        request(app.getHttpServer())
          .post('/vehicles')
          .set('Authorization', `Bearer ${driverToken}`),
        csrf,
      )
        .send({ brand: 'X', model: 'Y', year: 2023, licensePlate: 'ZZ-999', fuelType: 'diesel' })
        .expect(403);
    });

    it('un chauffeur ne peut pas lister les clés API (403, réservé admin)', async () => {
      await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });

    it('un chauffeur ne peut pas lire l’activité de toute l’entreprise (403)', async () => {
      await request(app.getHttpServer())
        .get('/audit-logs/company-activity')
        .set('Authorization', `Bearer ${driverToken}`)
        .expect(403);
    });
  });

  describe('Clés API — scopes', () => {
    let readKey: string;
    let deliveriesOnlyKey: string;

    it('un admin crée une clé (valeur renvoyée une seule fois)', async () => {
      const res = await withCsrf(
        request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminToken}`),
        csrf,
      )
        .send({ name: 'e2e tracking key', scopes: ['tracking:read', 'deliveries:read'] })
        .expect(201);

      expect(res.body.key).toMatch(/^dt_[0-9a-f]{64}$/);
      expect(res.body.scopes).toEqual(['tracking:read', 'deliveries:read']);
      readKey = res.body.key;

      const res2 = await withCsrf(
        request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminToken}`),
        csrf,
      )
        .send({ name: 'e2e deliveries only', scopes: ['deliveries:read'] })
        .expect(201);
      deliveriesOnlyKey = res2.body.key;
    });

    it('la liste ne renvoie jamais la valeur de la clé', async () => {
      const res = await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      for (const k of res.body) {
        expect(k).not.toHaveProperty('key');
        expect(k).not.toHaveProperty('keyHash');
        expect(k.prefix).toMatch(/^dt_/);
      }
    });

    it('X-API-Key avec le bon scope passe le guard (pas de 401/403)', async () => {
      // La livraison n'existe pas → 404 attendu, mais surtout PAS 401/403 :
      // ça prouve que la clé a authentifié et que le scope tracking:read a été accepté.
      const res = await request(app.getHttpServer())
        .get('/tracking/positions/00000000-0000-0000-0000-000000000000')
        .set('X-API-Key', readKey);
      expect([200, 404]).toContain(res.status);
    });

    it('X-API-Key sans le scope requis est rejeté (401)', async () => {
      // ApiKeyOrJwtGuard répond 401 « missing required scope » (uniforme avec ses
      // autres rejets d'auth), pas 403 — l'important est que l'accès soit refusé.
      await request(app.getHttpServer())
        .get('/tracking/positions/00000000-0000-0000-0000-000000000000')
        .set('X-API-Key', deliveriesOnlyKey)
        .expect(401);
    });

    it('une clé révoquée ne fonctionne plus (401)', async () => {
      const list = await request(app.getHttpServer())
        .get('/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const toRevoke = list.body.find((k: { name: string }) => k.name === 'e2e deliveries only');

      await withCsrf(
        request(app.getHttpServer())
          .delete(`/api-keys/${toRevoke.id}`)
          .set('Authorization', `Bearer ${adminToken}`),
        csrf,
      ).expect(200);

      await request(app.getHttpServer())
        .get('/tracking/positions/00000000-0000-0000-0000-000000000000')
        .set('X-API-Key', deliveriesOnlyKey)
        .expect(401);
    });

    it('un scope inconnu à la création est rejeté (400)', async () => {
      await withCsrf(
        request(app.getHttpServer()).post('/api-keys').set('Authorization', `Bearer ${adminToken}`),
        csrf,
      )
        .send({ name: 'bad', scopes: ['deliveries:write', 'admin:*'] })
        .expect(400);
    });
  });

  describe('Webhooks — validation anti-SSRF', () => {
    it('accepte une URL HTTPS publique et ne renvoie le secret qu’ici', async () => {
      const res = await withCsrf(
        request(app.getHttpServer()).post('/webhooks').set('Authorization', `Bearer ${adminToken}`),
        csrf,
      )
        .send({ url: 'https://example.com/hook', events: ['delivery.delivered'] })
        .expect(201);
      expect(res.body.secret).toMatch(/^whsec_/);

      const list = await request(app.getHttpServer())
        .get('/webhooks')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      for (const w of list.body) expect(w).not.toHaveProperty('secret');
    });

    it.each([
      ['loopback', 'https://127.0.0.1/hook'],
      ['métadonnées cloud', 'https://169.254.169.254/latest/meta-data'],
      ['RFC1918', 'https://10.1.2.3/hook'],
    ])('rejette une URL interne — %s (400)', async (_label, url) => {
      await withCsrf(
        request(app.getHttpServer()).post('/webhooks').set('Authorization', `Bearer ${adminToken}`),
        csrf,
      )
        .send({ url, events: ['delivery.delivered'] })
        .expect(400);
    });

    it('rejette une URL non-HTTPS (400, contrainte DTO)', async () => {
      await withCsrf(
        request(app.getHttpServer()).post('/webhooks').set('Authorization', `Bearer ${adminToken}`),
        csrf,
      )
        .send({ url: 'http://example.com/hook', events: ['delivery.delivered'] })
        .expect(400);
    });

    it('un chauffeur ne peut pas créer de webhook (403)', async () => {
      await withCsrf(
        request(app.getHttpServer())
          .post('/webhooks')
          .set('Authorization', `Bearer ${driverToken}`),
        csrf,
      )
        .send({ url: 'https://example.com/hook', events: ['delivery.delivered'] })
        .expect(403);
    });
  });
});
