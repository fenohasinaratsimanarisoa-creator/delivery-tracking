import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';

describe('CRUD Operations (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let accessToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const company = await prisma.company.create({ data: { name: 'CRUD Test Company' } });
    companyId = company.id;

    // Register and login
    const user = await prisma.user.create({
      data: {
        email: 'crud@test.com',
        passwordHash: '$2b$12$LJ3m4ys3Lg3YOCwR1Di7Nu5pFJGxBhB8P4h5Vg5W5y3q5n5q5n5qO', // dummy hash
        firstName: 'CRUD',
        lastName: 'Tester',
        role: 'admin',
        companyId,
      },
    });

    // Get token by logging in
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'crud@test.com', password: 'StrongPass123' });

    if (loginRes.status === 200) {
      accessToken = loginRes.body.accessToken;
    } else {
      // Register a new user for testing
      const regRes = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          email: 'crud2@test.com',
          password: 'StrongPass123',
          firstName: 'CRUD',
          lastName: 'Tester',
          role: 'admin',
          companyId,
        });
      accessToken = regRes.body.accessToken;
    }
  }, 15000);

  afterAll(async () => {
    await prisma.delivery.deleteMany({ where: { companyId } });
    await prisma.driver.deleteMany({ where: { companyId } });
    await prisma.vehicle.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await app.close();
  });

  let vehicleId: string;
  let driverId: string;
  let deliveryId: string;

  describe('Vehicles', () => {
    it('POST /vehicles - should create a vehicle', async () => {
      const res = await request(app.getHttpServer())
        .post('/vehicles')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ brand: 'Toyota', model: 'Hilux', year: 2023, licensePlate: 'CRUD-001', fuelType: 'diesel' })
        .expect(201);

      expect(res.body.brand).toBe('Toyota');
      vehicleId = res.body.id;
    });

    it('GET /vehicles - should list vehicles', async () => {
      const res = await request(app.getHttpServer())
        .get('/vehicles')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.meta).toBeDefined();
    });

    it('GET /vehicles/:id - should get one vehicle', async () => {
      const res = await request(app.getHttpServer())
        .get(`/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(vehicleId);
    });

    it('PATCH /vehicles/:id - should update a vehicle', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/vehicles/${vehicleId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ year: 2024 })
        .expect(200);

      expect(res.body.year).toBe(2024);
    });

    it('DELETE /vehicles/:id - should delete a vehicle', async () => {
      await request(app.getHttpServer())
        .delete(`/vehicles/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(404);
    });
  });

  describe('Drivers', () => {
    it('POST /drivers - should create a driver', async () => {
      const res = await request(app.getHttpServer())
        .post('/drivers')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ firstName: 'John', lastName: 'Driver', licenseNumber: 'LIC-CRUD-001' })
        .expect(201);

      expect(res.body.firstName).toBe('John');
      driverId = res.body.id;
    });

    it('GET /drivers - should list drivers', async () => {
      const res = await request(app.getHttpServer())
        .get('/drivers')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
    });
  });

  describe('Deliveries', () => {
    beforeAll(async () => {
      // Re-create vehicle and driver for delivery tests
      const v = await prisma.vehicle.create({
        data: { brand: 'Test', model: 'V', year: 2023, licensePlate: 'DLV-001', fuelType: 'gasoline', companyId },
      });
      vehicleId = v.id;
      const d = await prisma.driver.create({
        data: { firstName: 'Del', lastName: 'Very', licenseNumber: 'LIC-DLV-001', companyId },
      });
      driverId = d.id;
    });

    it('POST /deliveries - should create a delivery', async () => {
      const res = await request(app.getHttpServer())
        .post('/deliveries')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Test Delivery',
          pickupAddress: '123 Pickup St',
          deliveryAddress: '456 Delivery Ave',
          vehicleId,
          driverId,
        })
        .expect(201);

      expect(res.body.status).toBe('pending');
      deliveryId = res.body.id;
    });

    it('PATCH /deliveries/:id/status - should transition pending -> assigned', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'assigned' })
        .expect(200);

      expect(res.body.status).toBe('assigned');
    });

    it('PATCH /deliveries/:id/status - should reject invalid transition pending -> delivered', async () => {
      // Re-create a delivery in pending status for this test
      const d = await prisma.delivery.create({
        data: {
          title: 'Invalid Transition Test',
          pickupAddress: 'A', deliveryAddress: 'B',
          companyId, vehicleId, driverId,
        },
      });

      await request(app.getHttpServer())
        .patch(`/deliveries/${d.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'delivered' })
        .expect(400);

      await prisma.delivery.delete({ where: { id: d.id } });
    });

    it('PATCH /deliveries/:id/status - should transition assigned -> in_progress -> delivered', async () => {
      await request(app.getHttpServer())
        .patch(`/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'in_progress' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'delivered' })
        .expect(200);

      expect(res.body.status).toBe('delivered');
      expect(res.body.completedAt).toBeDefined();
    });

    it('PATCH /deliveries/:id/status - should reject transition from delivered', async () => {
      await request(app.getHttpServer())
        .patch(`/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status: 'pending' })
        .expect(400);
    });

    it('GET /deliveries - should filter by status', async () => {
      const res = await request(app.getHttpServer())
        .get('/deliveries?status=delivered')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.every((d: any) => d.status === 'delivered')).toBe(true);
    });
  });
});
