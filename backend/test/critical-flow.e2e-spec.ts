import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { DeliveryStatus, NotificationPriority, NotificationType } from '@prisma/client';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { CsrfContext, fetchCsrf, withCsrf } from './helpers/csrf';

describe('Critical delivery flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string | undefined;

  const runId = Date.now().toString();
  const password = 'StrongPass123!';
  const adminEmail = `critical-flow-${runId}@test.com`;

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
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

  it('covers signup, login, delivery creation, driver assignment, status update, and notification creation', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        companyName: `Critical Flow Company ${runId}`,
        email: adminEmail,
        password,
        firstName: 'Critical',
        lastName: 'Admin',
      })
      .expect(200);

    expect(registerRes.body.accessToken).toBeDefined();
    expect(registerRes.body.user.email).toBe(adminEmail);
    companyId = registerRes.body.user.companyId;

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);

    const accessToken = loginRes.body.accessToken as string;
    expect(accessToken).toBeDefined();

    const csrf: CsrfContext = await fetchCsrf(app);

    const vehicleRes = await withCsrf(
      request(app.getHttpServer()).post('/vehicles').set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({
        brand: 'Toyota',
        model: 'Hilux',
        year: 2024,
        licensePlate: `FLOW-${runId}`,
        fuelType: 'diesel',
      })
      .expect(201);

    const deliveryRes = await withCsrf(
      request(app.getHttpServer())
        .post('/deliveries')
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({
        title: `Critical delivery ${runId}`,
        pickupAddress: 'Warehouse A',
        deliveryAddress: 'Customer B',
        vehicleId: vehicleRes.body.id,
      })
      .expect(201);

    expect(deliveryRes.body.status).toBe(DeliveryStatus.pending);

    const driverRes = await withCsrf(
      request(app.getHttpServer()).post('/drivers').set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({
        firstName: 'Flow',
        lastName: 'Driver',
        licenseNumber: `LIC-FLOW-${runId}`,
      })
      .expect(201);

    const assignedRes = await withCsrf(
      request(app.getHttpServer())
        .patch(`/deliveries/${deliveryRes.body.id}`)
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({ driverId: driverRes.body.id })
      .expect(200);

    expect(assignedRes.body.driver.id).toBe(driverRes.body.id);

    const statusRes = await withCsrf(
      request(app.getHttpServer())
        .patch(`/deliveries/${deliveryRes.body.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`),
      csrf,
    )
      .send({ status: DeliveryStatus.assigned })
      .expect(200);

    expect(statusRes.body.status).toBe(DeliveryStatus.assigned);

    const notification = await prisma.notification.findFirst({
      where: {
        companyId,
        deliveryId: deliveryRes.body.id,
        type: NotificationType.delivery_status,
      },
      orderBy: { createdAt: 'desc' },
    });

    expect(notification).toMatchObject({
      priority: NotificationPriority.medium,
      title: `Livraison ${DeliveryStatus.assigned}`,
      link: `/deliveries/${deliveryRes.body.id}`,
    });
    expect(notification?.message).toContain('est maintenant assigned');
  });
});
