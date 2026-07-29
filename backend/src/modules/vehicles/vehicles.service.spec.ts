import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VehiclesService } from './vehicles.service';

const mockPrisma = {
  vehicle: {
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

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: any) => {
    if (key === 'TRACCAR_URL') return 'http://traccar:8082';
    if (key === 'TRACCAR_USER') return 'admin';
    if (key === 'TRACCAR_PASSWORD') return 'admin';
    return defaultValue;
  }),
};

describe('VehiclesService', () => {
  let service: VehiclesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VehiclesService(
      mockPrisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
    );
  });

  const dto = {
    brand: 'Toyota',
    model: 'Hilux',
    year: 2024,
    licensePlate: 'TRK-001',
    fuelType: 'diesel',
    theoreticalConsumption: 8.5,
  };

  describe('create', () => {
    it('creates a vehicle when the plate is unique', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.create.mockResolvedValueOnce({
        id: 'vehicle-1',
        ...dto,
        companyId: 'company-1',
      });

      await expect(service.create('company-1', dto)).resolves.toMatchObject({
        id: 'vehicle-1',
      });
      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1', positionSource: 'phone' },
      });
    });

    it('rejects duplicate plates', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });

      await expect(service.create('company-1', dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });

    it('rejects physical_tracker without traccarDeviceId', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('company-1', { ...dto, positionSource: 'physical_tracker' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create('company-1', { ...dto, positionSource: 'physical_tracker' }),
      ).rejects.toThrow(/traccarDeviceId is required/);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });

    it('accepts physical_tracker with traccarDeviceId', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.create.mockResolvedValueOnce({
        id: 'vehicle-1',
        ...dto,
        companyId: 'company-1',
        positionSource: 'physical_tracker',
        traccarDeviceId: '42',
      });

      await expect(
        service.create('company-1', {
          ...dto,
          positionSource: 'physical_tracker',
          traccarDeviceId: '42',
        }),
      ).resolves.toMatchObject({ id: 'vehicle-1' });
    });

    it('rejects duplicate traccarDeviceId', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-existing' });

      await expect(
        service.create('company-1', {
          ...dto,
          positionSource: 'physical_tracker',
          traccarDeviceId: '42',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });
  });

  it('builds filters and pagination for vehicle listing', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([{ id: 'vehicle-1' }]);
    mockPrisma.vehicle.count.mockResolvedValueOnce(12);

    await expect(
      service.findAll('company-1', {
        search: 'hilux',
        brand: 'Toyota',
        isActive: true,
        page: 2,
        limit: 5,
      }),
    ).resolves.toEqual({
      data: [{ id: 'vehicle-1' }],
      meta: { total: 12, page: 2, limit: 5, totalPages: 3 },
    });
    expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        deletedAt: null,
        OR: [
          { brand: { contains: 'hilux', mode: 'insensitive' } },
          { model: { contains: 'hilux', mode: 'insensitive' } },
          { licensePlate: { contains: 'hilux', mode: 'insensitive' } },
        ],
        brand: { equals: 'Toyota', mode: 'insensitive' },
        isActive: true,
      },
      skip: 5,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  });

  describe('findOne', () => {
    it('returns a vehicle in the company scope', async () => {
      const vehicle = { id: 'vehicle-1', companyId: 'company-1' };
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);

      await expect(service.findOne('company-1', 'vehicle-1')).resolves.toEqual(vehicle);
    });

    it('throws when the vehicle is not found', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates a vehicle after ownership and plate checks', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.vehicle.update.mockResolvedValueOnce({
        id: 'vehicle-1',
        licensePlate: 'TRK-NEW',
      });

      await expect(
        service.update('company-1', 'vehicle-1', { licensePlate: 'TRK-NEW' }),
      ).resolves.toMatchObject({ licensePlate: 'TRK-NEW' });
      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { licensePlate: 'TRK-NEW' },
      });
    });

    it('rejects a plate already used by another vehicle', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-2' });

      await expect(
        service.update('company-1', 'vehicle-1', { licensePlate: 'TRK-TAKEN' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('soft deletes an unused vehicle', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.update.mockResolvedValueOnce({ id: 'vehicle-1' });

      await service.remove('company-1', 'vehicle-1');
      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('blocks deletion while assigned to an in-progress delivery', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({ id: 'delivery-1' });

      await expect(service.remove('company-1', 'vehicle-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
    });
  });
});
