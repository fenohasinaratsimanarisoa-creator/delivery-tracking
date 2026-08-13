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
});
