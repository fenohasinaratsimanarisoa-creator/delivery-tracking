import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
import { VehicleAssignmentHistoryService } from '../../common/vehicle-assignment/vehicle-assignment-history.service';
import { DriversService } from './drivers.service';

const mockPrisma = {
  driver: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  vehicle: {
    findFirst: jest.fn(),
  },
  delivery: {
    findFirst: jest.fn(),
  },
  vehicleAssignmentHistory: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) return Promise.all(arg);
    return Promise.resolve(arg);
  }),
};

describe('DriversService', () => {
  let service: DriversService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DriversService(
      mockPrisma as unknown as PrismaService,
      { emitUpdate: jest.fn() } as any,
      new VehicleAssignmentHistoryService(),
    );
  });

  describe('create', () => {
    it('creates a driver scoped to the company when license is unique', async () => {
      const dto = {
        firstName: 'Alice',
        lastName: 'Driver',
        licenseNumber: 'LIC-001',
      };
      const created = { id: 'driver-1', ...dto, companyId: 'company-1' };
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);
      mockPrisma.driver.create.mockResolvedValueOnce(created);

      await expect(service.create('company-1', dto)).resolves.toEqual(created);
      expect(mockPrisma.driver.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1' },
        include: {
          vehicle: {
            select: {
              id: true,
              brand: true,
              model: true,
              year: true,
              licensePlate: true,
              fuelType: true,
              positionSource: true,
            },
          },
        },
      });
    });

    it('rejects duplicate license numbers', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });

      await expect(
        service.create('company-1', {
          firstName: 'Alice',
          lastName: 'Driver',
          licenseNumber: 'LIC-001',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.driver.create).not.toHaveBeenCalled();
    });
  });

  it('finds the driver profile for a user with assigned vehicle summary', async () => {
    const driver = { id: 'driver-1', userId: 'user-1' };
    mockPrisma.driver.findFirst.mockResolvedValueOnce(driver);

    await expect(service.findByUserId('user-1')).resolves.toEqual(driver);
    expect(mockPrisma.driver.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      include: {
        vehicle: {
          select: {
            id: true,
            brand: true,
            model: true,
            year: true,
            licensePlate: true,
            fuelType: true,
            positionSource: true,
          },
        },
      },
    });
  });

  it('returns paginated drivers for the company', async () => {
    mockPrisma.driver.findMany.mockResolvedValueOnce([{ id: 'driver-1' }]);
    mockPrisma.driver.count.mockResolvedValueOnce(21);

    await expect(service.findAll('company-1', 2, 10)).resolves.toEqual({
      data: [{ id: 'driver-1' }],
      meta: { total: 21, page: 2, limit: 10, totalPages: 3 },
    });
    expect(mockPrisma.driver.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-1', deletedAt: null },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        vehicle: {
          select: { id: true, brand: true, model: true, licensePlate: true },
        },
      },
    });
  });

  describe('findOne', () => {
    it('returns a driver owned by the company', async () => {
      const driver = { id: 'driver-1', companyId: 'company-1' };
      mockPrisma.driver.findFirst.mockResolvedValueOnce(driver);

      await expect(service.findOne('company-1', 'driver-1')).resolves.toEqual(driver);
    });

    it('throws when the driver does not exist in the company scope', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates after validating ownership and license uniqueness', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });
      mockPrisma.driver.update.mockResolvedValueOnce({
        id: 'driver-1',
        licenseNumber: 'LIC-NEW',
      });

      await expect(
        service.update('company-1', 'driver-1', { licenseNumber: 'LIC-NEW' }),
      ).resolves.toEqual({ id: 'driver-1', licenseNumber: 'LIC-NEW' });
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { licenseNumber: 'LIC-NEW' },
        include: {
          vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } },
        },
      });
    });

    it('rejects a license number already used by another driver', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-2' });

      await expect(
        service.update('company-1', 'driver-1', { licenseNumber: 'LIC-TAKEN' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes a driver with no in-progress delivery', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      mockPrisma.driver.update.mockResolvedValueOnce({
        id: 'driver-1',
        deletedAt: new Date('2026-07-21T00:00:00.000Z'),
      });

      await service.remove('company-1', 'driver-1');
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('blocks deletion while the driver has an in-progress delivery', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({ id: 'delivery-1' });

      await expect(service.remove('company-1', 'driver-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.driver.update).not.toHaveBeenCalled();
    });

    it('libère le vehicleId au soft-delete : un NOUVEAU driver peut ensuite être assigné au même véhicule', async () => {
      const dto = {
        firstName: 'Alice',
        lastName: 'Driver',
        licenseNumber: 'LIC-001',
        vehicleId: 'vehicle-1',
      };

      // 1) Création d'un driver assigné au véhicule vehicle-1
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null); // license unique
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-1',
        companyId: 'company-1',
      });
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null); // véhicule libre
      mockPrisma.driver.create.mockResolvedValueOnce({
        id: 'driver-1',
        ...dto,
        companyId: 'company-1',
      });
      mockPrisma.vehicleAssignmentHistory.findFirst.mockResolvedValue(null); // pas de ligne ouverte
      await service.create('company-1', dto);

      // 2) Suppression du driver → le soft-delete null le vehicleId et ferme
      //    la ligne d'historique d'assignation dans la MÊME transaction
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1', vehicleId: 'vehicle-1' }); // findOne
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ vehicleId: 'vehicle-1' }); // lecture tx
      mockPrisma.driver.update.mockResolvedValueOnce({
        id: 'driver-1',
        deletedAt: new Date(),
        vehicleId: null,
      });
      mockPrisma.vehicleAssignmentHistory.updateMany.mockResolvedValue({ count: 1 }); // unassign
      await service.remove('company-1', 'driver-1');

      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          vehicleId: null,
        }),
      });
      expect(mockPrisma.vehicleAssignmentHistory.updateMany).toHaveBeenCalledWith({
        where: { driverId: 'driver-1', unassignedAt: null },
        data: { unassignedAt: expect.any(Date) },
      });

      // 3) Le driver soft-deleted n'occupe plus la contrainte unique
      //    driver.vehicle_id → un NOUVEAU driver peut être créé/assigné sur le
      //    même vehicleId sans erreur de contrainte unique.
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null); // license unique
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-1',
        companyId: 'company-1',
      });
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null); // véhicule libre
      mockPrisma.driver.create.mockResolvedValueOnce({
        id: 'driver-2',
        ...dto,
        companyId: 'company-1',
      });

      await expect(service.create('company-1', dto)).resolves.toMatchObject({
        id: 'driver-2',
        vehicleId: 'vehicle-1',
      });
    });
  });
});
