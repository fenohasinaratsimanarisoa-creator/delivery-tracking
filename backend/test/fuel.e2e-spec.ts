import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';
import { CsrfContext, fetchCsrf, withCsrf } from './helpers/csrf';

describe('Fuel Consumption (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let accessToken: string;
  let vehicleId: string;
  let csrf: CsrfContext;

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

    const passwordHash = await bcrypt.hash('StrongPass123', 1);

    const company = await prisma.company.create({ data: { name: 'Fuel Test Company' } });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        email: 'fuel@test.com',
        passwordHash,
        firstName: 'Fuel',
        lastName: 'Tester',
        role: 'admin',
        companyId,
      },
    });

    const vehicle = await prisma.vehicle.create({
      data: {
        brand: 'Test',
        model: 'Car',
        year: 2023,
        licensePlate: `FUEL-${Date.now()}`,
        fuelType: 'diesel',
        theoreticalConsumption: 8.0,
        companyId,
      },
    });
    vehicleId = vehicle.id;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'fuel@test.com', password: 'StrongPass123' });
    accessToken = loginRes.body.accessToken;
    csrf = await fetchCsrf(app);
  }, 15000);

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { companyId } });
    await prisma.fuelLog.deleteMany({ where: { companyId } });
    await prisma.vehicle.delete({ where: { id: vehicleId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  async function waitForAnalysis(id: string, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const log = await prisma.fuelLog.findUnique({ where: { id } });
      if (log && log.calculatedConsumption !== null) return log;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for fuel analysis of ${id}`);
  }

  it('POST /fuel-consumption - should create a fuel log and calculate consumption', async () => {
    const res = await withCsrf(
      request(app.getHttpServer())
        .post('/fuel-consumption')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({
        liters: 50,
        kilometers: 600,
        cost: 75,
        fillDate: new Date().toISOString(),
        vehicleId,
      })
      .expect(201);

    expect(res.body.liters).toBe(50);
    expect(res.body.kilometers).toBe(600);

    const log = await waitForAnalysis(res.body.id);
    expect(log.calculatedConsumption).toBeCloseTo(8.33, 1); // 50/600*100
    expect(log.consumptionAnomalyFlag).toBe(false);
    expect(log.gpsAnomalyFlag).toBe(false);
  });

  it('POST /fuel-consumption - should flag anomaly when consumption deviates >20%', async () => {
    const res = await withCsrf(
      request(app.getHttpServer())
        .post('/fuel-consumption')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({
        liters: 100,
        kilometers: 500,
        cost: 150,
        fillDate: new Date().toISOString(),
        vehicleId,
      })
      .expect(201);

    // 100/500*100 = 20 L/100km, theoretical = 8, deviation = 150% > 20%
    const log = await waitForAnalysis(res.body.id);
    expect(log.calculatedConsumption).toBeCloseTo(20, 1);
    expect(log.consumptionAnomalyFlag).toBe(true);
    expect(log.consumptionAnomalyReason).toContain('20.0');
  });

  it('POST /fuel-consumption - should not flag anomaly when consumption is normal', async () => {
    const res = await withCsrf(
      request(app.getHttpServer())
        .post('/fuel-consumption')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({
        liters: 30,
        kilometers: 400,
        cost: 45,
        fillDate: new Date().toISOString(),
        vehicleId,
      })
      .expect(201);

    // 30/400*100 = 7.5 L/100km, theoretical = 8, deviation = 6.25% < 20%
    const log = await waitForAnalysis(res.body.id);
    expect(log.consumptionAnomalyFlag).toBe(false);
    expect(log.gpsAnomalyFlag).toBe(false);
  });

  it('GET /fuel-consumption - should list fuel logs with pagination', async () => {
    const res = await request(app.getHttpServer())
      .get('/fuel-consumption')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data).toBeInstanceOf(Array);
    expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    expect(res.body.meta).toBeDefined();
  });

  it('GET /fuel-consumption/stats - should return consumption statistics', async () => {
    const res = await request(app.getHttpServer())
      .get('/fuel-consumption/stats')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.totalLiters).toBeGreaterThan(0);
    expect(res.body.anomalyCount).toBe(1);
    expect(res.body.averageConsumption).toBeGreaterThan(0);
  });

  it('GET /fuel-consumption/stats?vehicleId= - should filter stats by vehicle', async () => {
    const res = await request(app.getHttpServer())
      .get(`/fuel-consumption/stats?vehicleId=${vehicleId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.logCount).toBeGreaterThanOrEqual(3);
  });

  it('PUT /fuel-consumption/prices/defaults - persists valid per-type default prices', async () => {
    const res = await withCsrf(
      request(app.getHttpServer())
        .put('/fuel-consumption/prices/defaults')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({ essence: 5000, gasoil: 4900, diesel: 4900, electric: 0, hybrid: 3000 })
      .expect(200);

    expect(res.body.defaults).toEqual({ essence: 5000, gasoil: 4900, diesel: 4900, electric: 0, hybrid: 3000 });

    const settings = await prisma.companyFuelSettings.findUnique({ where: { companyId } });
    expect(settings?.defaultFuelPrices).toMatchObject({ essence: 5000, diesel: 4900 });
  });

  it('PUT /fuel-consumption/prices/defaults - rejects an unknown key with 400', async () => {
    const res = await withCsrf(
      request(app.getHttpServer())
        .put('/fuel-consumption/prices/defaults')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({ mazout: 100 })
      .expect(400);

    console.log(`[e2e unknown key] ${res.status}: ${JSON.stringify(res.body.message)}`);
    expect(res.body.message.some((m: string) => m.includes('mazout should not exist'))).toBe(true);
  });

  it('PUT /fuel-consumption/prices/defaults - rejects an out-of-bounds value with 400', async () => {
    const res = await withCsrf(
      request(app.getHttpServer())
        .put('/fuel-consumption/prices/defaults')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({ diesel: 60000 })
      .expect(400);

    console.log(`[e2e out of bounds] ${res.status}: ${JSON.stringify(res.body.message)}`);
    expect(
      res.body.message.some((m: string) => m.includes('diesel must not be greater than 50000')),
    ).toBe(true);
  });
});
