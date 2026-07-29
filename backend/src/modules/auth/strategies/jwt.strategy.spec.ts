import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../../common/prisma/prisma.service';

const mockRedis = {
  get: jest.fn(),
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
  platformAdmin: {
    findUnique: jest.fn(),
  },
};

const mockConfigService = {
  get: jest.fn().mockReturnValue('test-secret'),
};

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(
      mockConfigService as unknown as ConfigService,
      mockPrisma as unknown as PrismaService,
      mockRedis as any,
    );
  });

  it('should reject payload with scope 2fa_pending', async () => {
    const payload = {
      sub: 'user-1',
      email: 'test@test.com',
      role: 'admin' as const,
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      scope: '2fa_pending' as const,
    };

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  const activeUser = {
    id: 'user-1',
    email: 'test@test.com',
    role: 'admin' as const,
    companyId: 'comp-1',
    isActive: true,
    firstName: 'John',
    lastName: 'Doe',
    company: { deletedAt: null },
  };

  it('should accept payload with scope access', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockPrisma.user.findUnique.mockResolvedValueOnce(activeUser);

    const payload = {
      sub: 'user-1',
      email: 'test@test.com',
      role: 'admin' as const,
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      scope: 'access' as const,
      iat: 1000,
    };

    const result = await strategy.validate(payload);
    expect(result).toMatchObject({ id: 'user-1', type: 'user' });
  });

  it('should accept payload without scope (backward compat)', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockPrisma.user.findUnique.mockResolvedValueOnce(activeUser);

    const payload = {
      sub: 'user-1',
      email: 'test@test.com',
      role: 'admin' as const,
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      iat: 1000,
    };

    const result = await strategy.validate(payload);
    expect(result).toMatchObject({ id: 'user-1', type: 'user' });
  });

  it('should reject token when user session has been revoked after token issuance', async () => {
    mockRedis.get.mockResolvedValueOnce('2000');

    const payload = {
      sub: 'user-1',
      email: 'test@test.com',
      role: 'admin' as const,
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      iat: 1000,
    };

    await expect(strategy.validate(payload)).rejects.toThrow('Token has been revoked');
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('should accept token when revocation timestamp is before token iat', async () => {
    mockRedis.get.mockResolvedValueOnce('500');
    mockPrisma.user.findUnique.mockResolvedValueOnce(activeUser);

    const payload = {
      sub: 'user-1',
      email: 'test@test.com',
      role: 'admin' as const,
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      iat: 1000,
    };

    const result = await strategy.validate(payload);
    expect(result).toMatchObject({ id: 'user-1', type: 'user' });
  });

  it('should reject token when company is soft-deleted', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockPrisma.user.findUnique.mockResolvedValueOnce({
      ...activeUser,
      company: { deletedAt: new Date('2026-07-28') },
    });

    const payload = {
      sub: 'user-1',
      email: 'test@test.com',
      role: 'admin' as const,
      companyId: 'comp-1',
      firstName: 'John',
      lastName: 'Doe',
      iat: 1000,
    };

    await expect(strategy.validate(payload)).rejects.toThrow('Company has been deleted');
  });
});
