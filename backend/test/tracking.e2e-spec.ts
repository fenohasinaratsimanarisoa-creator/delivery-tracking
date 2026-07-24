import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { io as Client } from 'socket.io-client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';

describe('Tracking GPS (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let companyId: string;
  let driverToken: string;
  let dispatcherToken: string;
  let deliveryId: string;
  let vehicleId: string;
  let driverId: string;
  let serverPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    const server = app.getHttpServer();
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        serverPort = server.address().port;
        resolve();
      });
    });

    prisma = app.get(PrismaService);

    const company = await prisma.company.create({ data: { name: 'Tracking Test' } });
    companyId = company.id;
    const passwordHash = await bcrypt.hash('StrongPass123', 1);

    const vehicle = await prisma.vehicle.create({
      data: {
        brand: 'Test',
        model: 'V',
        year: 2023,
        licensePlate: `TRACK-${Date.now()}`,
        fuelType: 'gasoline',
        companyId,
      },
    });
    vehicleId = vehicle.id;

    const driverUser = await prisma.user.create({
      data: {
        email: 'driver@tracking-test.com',
        passwordHash,
        firstName: 'Test',
        lastName: 'Driver',
        role: 'driver',
        companyId,
      },
    });

    const driverRecord = await prisma.driver.create({
      data: {
        firstName: 'Test',
        lastName: 'Driver',
        licenseNumber: `TRACK-DRV-${Date.now()}`,
        companyId,
        userId: driverUser.id,
        vehicleId,
      },
    });
    driverId = driverRecord.id;

    await prisma.user.create({
      data: {
        email: 'disp@tracking-test.com',
        passwordHash,
        firstName: 'Test',
        lastName: 'Dispatcher',
        role: 'dispatcher',
        companyId,
      },
    });

    const delivery = await prisma.delivery.create({
      data: {
        title: 'Tracking Test Delivery',
        pickupAddress: 'A',
        deliveryAddress: 'B',
        companyId,
        vehicleId,
        driverId,
      },
    });
    deliveryId = delivery.id;

    const loginDriver = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'driver@tracking-test.com', password: 'StrongPass123' });
    driverToken = loginDriver.body.accessToken;

    const loginDisp = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'disp@tracking-test.com', password: 'StrongPass123' });
    dispatcherToken = loginDisp.body.accessToken;
  }, 20000);

  afterAll(async () => {
    if (deliveryId) {
      await prisma.gpsPosition.deleteMany({ where: { deliveryId } });
      await prisma.delivery.delete({ where: { id: deliveryId } });
    }
    if (driverId) await prisma.driver.delete({ where: { id: driverId } });
    if (vehicleId) await prisma.vehicle.delete({ where: { id: vehicleId } });
    if (companyId) {
      await prisma.notification.deleteMany({ where: { companyId } });
      await prisma.user.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } });
    }
    await app.close();
  });

  describe('REST API - Distance and positions', () => {
    it('GET /tracking/distance/:deliveryId - should return 0 for no positions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tracking/distance/${deliveryId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      expect(res.body.meters).toBe(0);
      expect(res.body.kilometers).toBe(0);
    });

    it('GET /tracking/positions/:deliveryId - should return empty array', async () => {
      const res = await request(app.getHttpServer())
        .get(`/tracking/positions/${deliveryId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('WebSocket - Position updates', () => {
    const waitForEvent = <T>(
      socket: ReturnType<typeof Client>,
      event: string,
      timeout = 5000,
    ): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeout);
        socket.once(event, (data: T) => {
          clearTimeout(timer);
          resolve(data);
        });
      });
    };

    let driverSocket: ReturnType<typeof Client>;
    let dispatcherSocket: ReturnType<typeof Client>;

    beforeAll(async () => {
      driverSocket = Client(`http://localhost:${serverPort}`, {
        auth: { token: driverToken },
        transports: ['websocket'],
        forceNew: true,
      });
      dispatcherSocket = Client(`http://localhost:${serverPort}`, {
        auth: { token: dispatcherToken },
        transports: ['websocket'],
        forceNew: true,
      });

      await Promise.all([
        new Promise<void>((resolve, reject) =>
          driverSocket.on('connect', resolve).on('connect_error', reject),
        ),
        new Promise<void>((resolve, reject) =>
          dispatcherSocket.on('connect', resolve).on('connect_error', reject),
        ),
      ]);
    }, 10000);

    afterAll(() => {
      driverSocket?.close();
      dispatcherSocket?.close();
    });

    it('should receive position update on dispatcher when driver sends one', async () => {
      const eventPromise = waitForEvent<{
        latitude: number;
        longitude: number;
        deliveryId: string;
      }>(dispatcherSocket, 'positionUpdate');

      driverSocket.emit('updatePosition', {
        latitude: 48.8566,
        longitude: 2.3522,
        speed: 50,
        timestamp: new Date().toISOString(),
        deliveryId,
        vehicleId,
      });

      const data = await eventPromise;
      expect(data.latitude).toBe(48.8566);
      expect(data.longitude).toBe(2.3522);
      expect(data.deliveryId).toBe(deliveryId);
    }, 10000);

    it('should save position and return via REST', async () => {
      await new Promise((r) => setTimeout(r, 500));

      const res = await request(app.getHttpServer())
        .get(`/tracking/positions/${deliveryId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
      expect(res.body[0].latitude).toBe(48.8566);
    });

    it('should calculate distance with positions', async () => {
      const eventPromise = waitForEvent(dispatcherSocket, 'positionUpdate');

      driverSocket.emit('updatePosition', {
        latitude: 48.8584,
        longitude: 2.2945,
        speed: 60,
        timestamp: new Date().toISOString(),
        deliveryId,
        vehicleId,
      });

      await eventPromise;
      // Wait for DB write
      await new Promise((r) => setTimeout(r, 500));

      const res = await request(app.getHttpServer())
        .get(`/tracking/distance/${deliveryId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      expect(res.body.meters).toBeGreaterThan(4000);
      expect(res.body.meters).toBeLessThan(6000);
    }, 10000);

    it('should deduplicate identical positions', async () => {
      const pos = {
        latitude: 48.862,
        longitude: 2.352,
        timestamp: new Date(Date.now() - 7200000).toISOString(),
        deliveryId,
        vehicleId,
      };

      // Send twice and wait for broadcast
      const p1 = waitForEvent(dispatcherSocket, 'positionUpdate');
      driverSocket.emit('updatePosition', pos);
      await p1;

      const p2 = waitForEvent(dispatcherSocket, 'positionUpdate');
      driverSocket.emit('updatePosition', pos);
      await p2;

      await new Promise((r) => setTimeout(r, 500));

      const res = await request(app.getHttpServer())
        .get(`/tracking/positions/${deliveryId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      const dups = res.body.filter(
        (p: any) =>
          p.latitude === pos.latitude &&
          p.longitude === pos.longitude &&
          new Date(p.timestamp).getTime() === new Date(pos.timestamp).getTime(),
      );
      expect(dups.length).toBe(1);
    }, 15000);

    it('should handle batch position sending', async () => {
      // Just verify that batch does not throw and positions are saved
      driverSocket.emit('batchPosition', {
        positions: [
          {
            latitude: 48.863,
            longitude: 2.353,
            speed: 40,
            timestamp: new Date(Date.now() - 2000).toISOString(),
            deliveryId,
            vehicleId,
          },
          {
            latitude: 48.873,
            longitude: 2.363,
            speed: 45,
            timestamp: new Date(Date.now() - 1000).toISOString(),
            deliveryId,
            vehicleId,
          },
        ],
      });

      // Wait for the positions to be saved and broadcast
      await waitForEvent(dispatcherSocket, 'positionUpdate');
      await new Promise((r) => setTimeout(r, 500));

      const res = await request(app.getHttpServer())
        .get(`/tracking/positions/${deliveryId}`)
        .set('Authorization', `Bearer ${dispatcherToken}`)
        .expect(200);

      const batchPositions = res.body.filter(
        (p: any) => p.latitude === 48.863 || p.latitude === 48.873,
      );
      expect(batchPositions.length).toBe(2);
    }, 10000);
  });

  describe('WebSocket - Auth rejection', () => {
    it('should reject socket without token', async () => {
      await expect(
        new Promise<void>((resolve, reject) => {
          const badSocket = Client(`http://localhost:${serverPort}`, {
            transports: ['websocket'],
            forceNew: true,
          });

          badSocket.on('disconnect', () => {
            badSocket.close();
            resolve();
          });
          badSocket.on('connect_error', () => {
            badSocket.close();
            resolve();
          });
          setTimeout(() => {
            badSocket.close();
            reject(new Error('Socket should not connect without token'));
          }, 2000);
        }),
      ).resolves.toBeUndefined();
    }, 5000);
  });
});
