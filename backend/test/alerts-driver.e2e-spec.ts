import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { DeliveryStatus, NotificationPriority, NotificationType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CsrfContext, fetchCsrf, withCsrf } from './helpers/csrf';

describe('Alerts driver scoping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string | undefined;

  const runId = Date.now().toString();
  const password = 'StrongPass123!';
  const adminEmail = `alerts-driver-${runId}@test.com`;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

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
  });

  afterAll(async () => {
    if (companyId) {
      await prisma.notification.deleteMany({ where: { companyId } });
      await prisma.delivery.deleteMany({ where: { companyId } });
      await prisma.driver.deleteMany({ where: { companyId } });
      await prisma.vehicle.deleteMany({ where: { companyId } });
      await prisma.userSession.deleteMany({ where: { user: { companyId } } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
    await app.close();
  });

  it('un driver ne voit QUE ses propres alertes et reçoit 403 pour agir sur celles des autres', async () => {
    // ── 1. Entreprise + admin ─────────────────────────────────────────────
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        companyName: `Alerts Driver Co ${runId}`,
        email: adminEmail,
        password,
        firstName: 'Alerts',
        lastName: 'Admin',
      })
      .expect(200);

    companyId = registerRes.body.user.companyId;
    const cid: string = companyId!;
    const adminToken = registerRes.body.accessToken as string;
    expect(companyId).toBeDefined();

    const hash = await bcrypt.hash(password, 10);

    // ── 2. Deux drivers + un véhicule ─────────────────────────────────────
    const driverA = await prisma.user.create({
      data: {
        email: `driver-a-${runId}@test.com`,
        passwordHash: hash,
        firstName: 'Driver',
        lastName: 'A',
        role: UserRole.driver,
        companyId: cid,
        isActive: true,
      },
    });
    const driverB = await prisma.user.create({
      data: {
        email: `driver-b-${runId}@test.com`,
        passwordHash: hash,
        firstName: 'Driver',
        lastName: 'B',
        role: UserRole.driver,
        companyId: cid,
        isActive: true,
      },
    });

    const vehicleA = await prisma.vehicle.create({
      data: {
        companyId: cid,
        brand: 'Test',
        model: 'Moto',
        year: 2024,
        licensePlate: `ALRT-A-${runId.slice(-4)}`,
        fuelType: 'Essence',
      },
    });

    await prisma.driver.create({
      data: {
        companyId: cid,
        firstName: 'Driver',
        lastName: 'A',
        licenseNumber: `LIC-A-${runId.slice(-4)}`,
        userId: driverA.id,
        vehicleId: vehicleA.id,
      },
    });
    await prisma.driver.create({
      data: {
        companyId: cid,
        firstName: 'Driver',
        lastName: 'B',
        licenseNumber: `LIC-B-${runId.slice(-4)}`,
        userId: driverB.id,
      },
    });

    // ── 3. Livraisons assignées à chaque driver ───────────────────────────
    const deliveryA = await prisma.delivery.create({
      data: {
        companyId: cid,
        title: 'Livraison Driver A',
        status: DeliveryStatus.in_progress,
        pickupAddress: 'Départ A',
        deliveryAddress: 'Arrivée A',
        assignedDriverId: driverA.id,
      },
    });
    const deliveryB = await prisma.delivery.create({
      data: {
        companyId: cid,
        title: 'Livraison Driver B',
        status: DeliveryStatus.in_progress,
        pickupAddress: 'Départ B',
        deliveryAddress: 'Arrivée B',
        assignedDriverId: driverB.id,
      },
    });

    // ── 4. Alertes : A (livraison A), B (livraison B), carburant A (userId A),
    //       société (userId null, delivery null) ───────────────────────────
    const alertA = await prisma.notification.create({
      data: {
        companyId: cid,
        type: NotificationType.speed_alert,
        priority: NotificationPriority.high,
        title: 'Vitesse A',
        message: `A dépassé la limite (livraison ${deliveryA.title})`,
        deliveryId: deliveryA.id,
        resolved: false,
      },
    });
    const alertB = await prisma.notification.create({
      data: {
        companyId: cid,
        type: NotificationType.geofence_event,
        priority: NotificationPriority.high,
        title: 'Zone B',
        message: `Sortie de zone (livraison ${deliveryB.title})`,
        deliveryId: deliveryB.id,
        resolved: false,
      },
    });
    const alertFuelA = await prisma.notification.create({
      data: {
        companyId: cid,
        type: NotificationType.fuel_anomaly,
        priority: NotificationPriority.medium,
        title: 'Carburant A',
        message: 'Anomalie carburant véhicule A',
        userId: driverA.id,
        resolved: false,
      },
    });
    const alertCompany = await prisma.notification.create({
      data: {
        companyId: cid,
        type: NotificationType.system,
        priority: NotificationPriority.low,
        title: 'Info société',
        message: 'Maintenance prévue',
        resolved: false,
      },
    });

    // ── 5. Login des deux drivers ─────────────────────────────────────────
    const loginA = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverA.email, password })
      .expect(200);
    const tokenA = loginA.body.accessToken as string;

    const loginB = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: driverB.email, password })
      .expect(200);
    const tokenB = loginB.body.accessToken as string;

    // ── 6. Driver A : ne voit QUE ses alertes ─────────────────────────────
    const resA = await request(app.getHttpServer())
      .get('/alerts?limit=50')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const idsA = (resA.body.data as { id: string }[]).map((n) => n.id);
    expect(idsA).toContain(alertA.id);
    expect(idsA).toContain(alertFuelA.id);
    expect(idsA).not.toContain(alertB.id);
    expect(idsA).not.toContain(alertCompany.id);

    // ── 7. Driver B : ne voit QUE sa propre alerte ────────────────────────
    const resB = await request(app.getHttpServer())
      .get('/alerts?limit=50')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    const idsB = (resB.body.data as { id: string }[]).map((n) => n.id);
    expect(idsB).toContain(alertB.id);
    expect(idsB).not.toContain(alertA.id);
    expect(idsB).not.toContain(alertFuelA.id);
    expect(idsB).not.toContain(alertCompany.id);

    // ── 8. Driver A : 403 pour résoudre l'alerte d'un AUTRE driver ───────
    const csrf: CsrfContext = await fetchCsrf(app);
    await withCsrf(
      request(app.getHttpServer())
        .patch(`/alerts/${alertB.id}/resolve`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ comment: 'je résous celle de B' }),
      csrf,
    ).expect(403);

    // ── 9. Admin (contrôle) : scope société complet, voit les 4 ───────────
    const resAdmin = await request(app.getHttpServer())
      .get('/alerts?limit=50')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const idsAdmin = (resAdmin.body.data as { id: string }[]).map((n) => n.id);
    expect(idsAdmin).toEqual(
      expect.arrayContaining([alertA.id, alertB.id, alertFuelA.id, alertCompany.id]),
    );
  });
});
