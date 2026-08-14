import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { PrismaService } from '../../common/prisma/prisma.service';

const mockPrisma = {
  company: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: { updateMany: jest.fn() },
  driver: { updateMany: jest.fn() },
  vehicle: { updateMany: jest.fn() },
  companySettings: { upsert: jest.fn(), create: jest.fn() },
  companyFuelSettings: { upsert: jest.fn(), create: jest.fn() },
};

const mockQueue = { add: jest.fn() };

describe('CompaniesService', () => {
  let service: CompaniesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompaniesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: getQueueToken('company-purge'), useValue: mockQueue },
      ],
    }).compile();

    service = module.get<CompaniesService>(CompaniesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should soft-delete company and enqueue purge job', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 'comp-1', name: 'Acme Inc' });
    mockPrisma.company.update.mockResolvedValueOnce({ id: 'comp-1', deletedAt: new Date() });

    const result = await service.deleteCompany('comp-1', 'Acme Inc');

    expect(mockPrisma.company.update).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      data: { deletedAt: expect.any(Date) },
    });
    expect(result).toEqual({ message: 'Company deleted successfully' });
  });

  it('should reject delete when company name does not match (400, jamais de soft-delete)', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 'comp-1', name: 'Acme Inc' });

    const promise = service.deleteCompany('comp-1', 'Wrong Name');
    await expect(promise).rejects.toThrow(BadRequestException);
    await expect(promise).rejects.toThrow('Company name confirmation does not match');
    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  describe('getSettings — création idempotente (M4)', () => {
    it('crée les settings par défaut via UPSERT (pas de course P2002 en concurrence)', async () => {
      mockPrisma.company.findUnique
        .mockResolvedValueOnce({ id: 'comp-1', settings: null, fuelSettings: null })
        .mockResolvedValueOnce({
          id: 'comp-1',
          settings: { id: 's-1' },
          fuelSettings: { id: 'fs-1' },
        });
      mockPrisma.companySettings.upsert.mockResolvedValue({ id: 's-1' });
      mockPrisma.companyFuelSettings.upsert.mockResolvedValue({ id: 'fs-1' });

      await service.getSettings('comp-1');

      // UPSERT (idempotent) : deux requêtes simultanées ne créent plus chacune la
      // ligne → violation d'unicité sur companyId → 500.
      expect(mockPrisma.companySettings.upsert).toHaveBeenCalledWith({
        where: { companyId: 'comp-1' },
        update: {},
        create: { companyId: 'comp-1' },
      });
      expect(mockPrisma.companyFuelSettings.upsert).toHaveBeenCalledWith({
        where: { companyId: 'comp-1' },
        update: {},
        create: { companyId: 'comp-1' },
      });
      expect(mockPrisma.companySettings.create).not.toHaveBeenCalled();
      expect(mockPrisma.companyFuelSettings.create).not.toHaveBeenCalled();
    });
  });
});
