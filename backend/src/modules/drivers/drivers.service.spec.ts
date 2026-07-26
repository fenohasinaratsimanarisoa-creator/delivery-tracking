import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DataUpdateBus } from '../../common/events/data-update.bus';
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
  delivery: {
    findFirst: jest.fn(),
  },
};

describe('DriversService', () => {
  let service: DriversService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DriversService(mockPrisma as unknown as PrismaService, { emitUpdate: jest.fn() } as any);
  });

  describe('create', () => {
    it('creates a driver scoped to the company when license is unique', async () => {
      const dto = {
        firstName: 'Alice',
        lastName: 'Driver',
        licenseNumber: 'LIC-001',
      };
      const created = { id: 'driver-1', ...dto, companyId: 'company-1' };
      mockPrisma.driver.findUnique.mockResolvedValueOnce(null);
      mockPrisma.driver.create.mockResolvedValueOnce(created);

      await expect(service.create('company-1', dto)).resolves.toEqual(created);
      expect(mockPrisma.driver.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1' },
        include: { vehicle: { select: { id: true, brand: true, model: true, year: true, licensePlate: true, fuelType: true, positionSource: true } } },
      });
    });

    it('rejects duplicate license numbers', async () => {
      mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-1' });

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
          select: { id: true, brand: true, model: true, year: true, licensePlate: true, fuelType: true, positionSource: true },
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
      mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-1' });
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
        include: { vehicle: { select: { id: true, brand: true, model: true, licensePlate: true } } },
      });
    });

    it('rejects a license number already used by another driver', async () => {
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1' });
      mockPrisma.driver.findUnique.mockResolvedValueOnce({ id: 'driver-2' });

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
  });
});
