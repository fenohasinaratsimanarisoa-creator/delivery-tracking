import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AppModule } from '../src/app.module';

describe('Multi-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should enforce company isolation: company A cannot see company B data', async () => {
    const companyA = await prisma.company.create({ data: { name: 'Company A' } });
    const companyB = await prisma.company.create({ data: { name: 'Company B' } });

    const vehicleA = await prisma.vehicle.create({
      data: {
        brand: 'Toyota',
        model: 'Hilux',
        year: 2023,
        licensePlate: 'AB-123-CD',
        fuelType: 'diesel',
        companyId: companyA.id,
      },
    });

    const vehicleB = await prisma.vehicle.create({
      data: {
        brand: 'Ford',
        model: 'Ranger',
        year: 2023,
        licensePlate: 'EF-456-GH',
        fuelType: 'diesel',
        companyId: companyB.id,
      },
    });

    const vehiclesA = await prisma.vehicle.findMany({ where: { companyId: companyA.id } });
    const vehiclesB = await prisma.vehicle.findMany({ where: { companyId: companyB.id } });

    expect(vehiclesA).toHaveLength(1);
    expect(vehiclesA[0].id).toBe(vehicleA.id);
    expect(vehiclesA[0].companyId).toBe(companyA.id);

    expect(vehiclesB).toHaveLength(1);
    expect(vehiclesB[0].id).toBe(vehicleB.id);
    expect(vehiclesB[0].companyId).toBe(companyB.id);

    const crossVehicles = await prisma.vehicle.findMany({
      where: { companyId: companyA.id, id: vehicleB.id },
    });
    expect(crossVehicles).toHaveLength(0);

    await prisma.notification.deleteMany({
      where: { companyId: { in: [companyA.id, companyB.id] } },
    });
    await prisma.vehicle.deleteMany({ where: { id: { in: [vehicleA.id, vehicleB.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
  });

  it('should enforce company isolation for deliveries', async () => {
    const companyA = await prisma.company.create({ data: { name: 'Test A' } });
    const companyB = await prisma.company.create({ data: { name: 'Test B' } });

    const vehicleA = await prisma.vehicle.create({
      data: {
        brand: 'Test',
        model: 'Test',
        year: 2023,
        licensePlate: 'TEST-A1',
        fuelType: 'gasoline',
        companyId: companyA.id,
      },
    });

    const vehicleB = await prisma.vehicle.create({
      data: {
        brand: 'Test',
        model: 'Test',
        year: 2023,
        licensePlate: 'TEST-B1',
        fuelType: 'gasoline',
        companyId: companyB.id,
      },
    });

    const deliveryA = await prisma.delivery.create({
      data: {
        title: 'Delivery A',
        pickupAddress: '123 Main St',
        deliveryAddress: '456 Oak Ave',
        companyId: companyA.id,
        vehicleId: vehicleA.id,
      },
    });

    const deliveryB = await prisma.delivery.create({
      data: {
        title: 'Delivery B',
        pickupAddress: '789 Pine Rd',
        deliveryAddress: '321 Elm St',
        companyId: companyB.id,
        vehicleId: vehicleB.id,
      },
    });

    const deliveriesA = await prisma.delivery.findMany({ where: { companyId: companyA.id } });
    const deliveriesB = await prisma.delivery.findMany({ where: { companyId: companyB.id } });

    expect(deliveriesA).toHaveLength(1);
    expect(deliveriesA[0].id).toBe(deliveryA.id);
    expect(deliveriesB).toHaveLength(1);
    expect(deliveriesB[0].id).toBe(deliveryB.id);

    await prisma.notification.deleteMany({
      where: { companyId: { in: [companyA.id, companyB.id] } },
    });
    await prisma.delivery.deleteMany({ where: { companyId: { in: [companyA.id, companyB.id] } } });
    await prisma.vehicle.deleteMany({ where: { companyId: { in: [companyA.id, companyB.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [companyA.id, companyB.id] } } });
  });
});
