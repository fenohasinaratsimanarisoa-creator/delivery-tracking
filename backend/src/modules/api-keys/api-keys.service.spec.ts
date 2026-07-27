import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiKeysService } from './api-keys.service';

const mockPrisma = {
  apiKey: {
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApiKeysService(mockPrisma as unknown as PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates an API key and returns the raw key, prefix, name, and scopes', async () => {
      mockPrisma.apiKey.create.mockResolvedValueOnce({
        id: 'key-1',
        companyId: 'company-1',
        name: 'Test Key',
        keyHash: expect.any(String),
        prefix: expect.any(String),
        scopes: ['deliveries:read'],
        expiresAt: null,
      });

      const result = await service.create('company-1', {
        name: 'Test Key',
        scopes: ['deliveries:read'],
      });

      expect(result).toMatchObject({
        name: 'Test Key',
        scopes: ['deliveries:read'],
      });
      expect(result.key).toMatch(/^dt_/);
      expect(result.prefix).toMatch(/^dt_/);
      expect(mockPrisma.apiKey.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          companyId: 'company-1',
          name: 'Test Key',
          scopes: ['deliveries:read'],
        }),
      });
    });
  });

  describe('findAll', () => {
    it('returns all keys for a company (without hashes)', async () => {
      const keys = [
        { id: 'key-1', name: 'Test Key', prefix: 'dt_abc123', scopes: ['deliveries:read'], expiresAt: null, isActive: true, lastUsedAt: null, createdAt: new Date() },
      ];
      mockPrisma.apiKey.findMany.mockResolvedValueOnce(keys);

      const result = await service.findAll('company-1');

      expect(result).toEqual(keys);
      expect(mockPrisma.apiKey.findMany).toHaveBeenCalledWith({
        where: { companyId: 'company-1' },
        select: expect.objectContaining({ id: true, name: true, prefix: true }),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('remove', () => {
    it('soft-deletes (deactivates) an API key', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValueOnce({ id: 'key-1', companyId: 'company-1' });
      mockPrisma.apiKey.update.mockResolvedValueOnce({ id: 'key-1', isActive: false });

      await service.remove('company-1', 'key-1');

      expect(mockPrisma.apiKey.update).toHaveBeenCalledWith({
        where: { id: 'key-1' },
        data: { isActive: false },
      });
    });

    it('throws when the key is not found', async () => {
      mockPrisma.apiKey.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });
});
