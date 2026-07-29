import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PlatformAdminService } from './platform-admin.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TotpService } from '../auth/totp.service';
import { PlatformAdminLoginDto } from './dto/login.dto';
import { PlatformAdminVerify2faDto } from './dto/verify-2fa.dto';

jest.mock('bcrypt');

const mockPrisma = {
  auditLog: {
    create: jest.fn(),
  },
  platformAdmin: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  platformAuditLog: {
    create: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  company: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  subscription: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  invoice: {
    groupBy: jest.fn(),
  },
  delivery: {
    count: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn(),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string) => {
    const config: Record<string, string> = {
      JWT_ACCESS_SECRET: 'test-access-secret',
      JWT_REFRESH_SECRET: 'test-refresh-secret',
    };
    return config[key];
  }),
};

const mockTotpService = {
  generateSecret: jest.fn(),
  verifyToken: jest.fn(),
  generateQrCode: jest.fn(),
};

describe('PlatformAdminService', () => {
  let service: PlatformAdminService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformAdminService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TotpService, useValue: mockTotpService },
      ],
    }).compile();

    service = module.get<PlatformAdminService>(PlatformAdminService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('login', () => {
    const loginDto: PlatformAdminLoginDto = {
      email: 'admin@platform.com',
      password: 'StrongPass123!',
    };

    it('should throw UnauthorizedException when admin not found', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(null);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when admin is inactive', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({ id: 'admin-1', isActive: false });

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is invalid', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        isActive: true,
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should return temp token and 2FA setup when 2FA not enabled', async () => {
      const admin = {
        id: 'admin-1',
        email: 'admin@platform.com',
        firstName: 'Admin',
        lastName: 'User',
        isActive: true,
        totpEnabled: false,
        totpSecret: null,
      };

      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(admin);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockTotpService.generateSecret.mockResolvedValueOnce({
        secret: 'BASE32SECRET',
        qrCode: 'data:image/png;base64,...',
        otpauthUrl: 'otpauth://totp/...',
      });
      mockJwtService.sign.mockReturnValueOnce('temp_token');

      const result = await service.login(loginDto);

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.requires2faSetup).toBe(true);
      expect(result.tempToken).toBe('temp_token');
      expect(result.totpSecret).toBe('BASE32SECRET');
      expect(result.qrCode).toBeDefined();
      expect(mockTotpService.generateSecret).toHaveBeenCalledWith('admin@platform.com');
    });

    it('should return temp token when 2FA already enabled', async () => {
      const admin = {
        id: 'admin-1',
        email: 'admin@platform.com',
        firstName: 'Admin',
        lastName: 'User',
        isActive: true,
        totpEnabled: true,
        totpSecret: 'EXISTING_SECRET',
      };

      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(admin);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockJwtService.sign.mockReturnValueOnce('temp_token');

      const result = await service.login(loginDto);

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.requires2faSetup).toBe(false);
      expect(result.tempToken).toBe('temp_token');
    });

    it('should create audit log on login', async () => {
      const admin = {
        id: 'admin-1',
        isActive: true,
        totpEnabled: true,
        totpSecret: 'EXISTING_SECRET',
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'B',
      };
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(admin);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockJwtService.sign.mockReturnValueOnce('temp_token');

      await service.login(loginDto, '192.168.1.1', 'Chrome');

      expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: 'admin-1',
          action: 'login_2fa_required',
          ip: '192.168.1.1',
          userAgent: 'Chrome',
        },
      });
    });
  });

  describe('verify2fa', () => {
    const verifyDto: PlatformAdminVerify2faDto = {
      tempToken: 'valid_temp_token',
      token: '123456',
    };

    it('should throw UnauthorizedException when temp token is invalid', async () => {
      mockJwtService.verify.mockImplementationOnce(() => {
        throw new Error('invalid');
      });

      await expect(service.verify2fa(verifyDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when token scope is wrong', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'admin-1', scope: 'wrong_scope' });

      await expect(service.verify2fa(verifyDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when admin not found', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'admin-1', scope: '2fa_pending' });
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(null);

      await expect(service.verify2fa(verifyDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when 2FA not enabled', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'admin-1', scope: '2fa_pending' });
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        isActive: true,
        totpEnabled: false,
      });

      await expect(service.verify2fa(verifyDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when 2FA code is invalid', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'admin-1', scope: '2fa_pending' });
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        isActive: true,
        totpEnabled: true,
        totpSecret: 'SECRET',
      });
      mockTotpService.verifyToken.mockReturnValueOnce(false);

      await expect(service.verify2fa(verifyDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should enable 2FA and return tokens when code is valid', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'admin-1', scope: '2fa_pending' });
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        isActive: true,
        totpEnabled: true,
        totpSecret: 'SECRET',
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'B',
      });
      mockTotpService.verifyToken.mockReturnValueOnce(true);
      mockPrisma.platformAdmin.update.mockResolvedValueOnce({});
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockJwtService.sign.mockReturnValueOnce('access_token').mockReturnValueOnce('refresh_token');
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_refresh');

      const result = await service.verify2fa(verifyDto);

      expect(result.accessToken).toBe('access_token');
      expect(result.refreshToken).toBe('refresh_token');
    });

    it('should create audit log on successful 2FA verification', async () => {
      mockJwtService.verify.mockReturnValueOnce({ sub: 'admin-1', scope: '2fa_pending' });
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        isActive: true,
        totpEnabled: true,
        totpSecret: 'SECRET',
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'B',
      });
      mockTotpService.verifyToken.mockReturnValueOnce(true);
      mockPrisma.platformAdmin.update.mockResolvedValueOnce({});
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockJwtService.sign.mockReturnValue('token');
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');

      await service.verify2fa(verifyDto, '10.0.0.1', 'Firefox');

      expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith({
        data: {
          adminId: 'admin-1',
          action: 'login_success',
          ip: '10.0.0.1',
          userAgent: 'Firefox',
        },
      });
    });
  });

  describe('getTenants', () => {
    it('should return companies with subscription and counts', async () => {
      const companies = [
        {
          id: 'comp-1',
          name: 'Company 1',
          email: 'comp1@test.com',
          phone: '+123',
          createdAt: new Date(),
          users: [{ id: 'user-1', email: 'admin@comp1.com', firstName: 'A', lastName: 'B' }],
          subscription: {
            status: 'active',
            plan: { name: 'Pro', tier: 'pro', price: 4900 },
            currentPeriodEnd: new Date(),
          },
          _count: { users: 5, vehicles: 3, drivers: 2, deliveries: 100 },
        },
      ];

      mockPrisma.company.findMany.mockResolvedValueOnce(companies);

      const result = await service.getTenants();

      expect(result).toEqual(companies);
      expect(mockPrisma.company.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('toggleTenantStatus', () => {
    it('should activate a deleted company', async () => {
      const company = { id: 'comp-1', deletedAt: new Date(), users: [{ id: 'user-1' }] };
      mockPrisma.company.findUnique.mockResolvedValueOnce(company);
      mockPrisma.company.update.mockResolvedValueOnce({ id: 'comp-1', deletedAt: null });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});

      const result = await service.toggleTenantStatus('comp-1', 'admin-1');

      expect(result.activated).toBe(true);
      expect(mockPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { deletedAt: null },
      });
      expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('should deactivate an active company and its users', async () => {
      const company = { id: 'comp-1', deletedAt: null, users: [{ id: 'user-1' }] };
      mockPrisma.company.findUnique.mockResolvedValueOnce(company);
      mockPrisma.company.update.mockResolvedValueOnce({ id: 'comp-1', deletedAt: new Date() });
      mockPrisma.user.updateMany.mockResolvedValueOnce({ count: 5 });
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});

      const result = await service.toggleTenantStatus('comp-1', 'admin-1');

      expect(result.activated).toBe(false);
      expect(mockPrisma.company.update).toHaveBeenCalledWith({
        where: { id: 'comp-1' },
        data: { deletedAt: expect.any(Date) },
      });
      expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
        where: { companyId: 'comp-1', deletedAt: null },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('should throw UnauthorizedException when company not found', async () => {
      mockPrisma.company.findUnique.mockResolvedValueOnce(null);

      await expect(service.toggleTenantStatus('comp-1', 'admin-1')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('impersonate', () => {
    it('should return access token with impersonatedBy claim (no refresh token)', async () => {
      const company = { id: 'comp-1', deletedAt: null };
      const adminUser = {
        id: 'user-1',
        email: 'admin@comp1.com',
        role: 'admin',
        companyId: 'comp-1',
        firstName: 'Admin',
        lastName: 'User',
      };

      mockPrisma.company.findUnique.mockResolvedValueOnce(company);
      mockPrisma.user.findFirst.mockResolvedValueOnce(adminUser);
      mockJwtService.sign.mockReturnValue('impersonation_token');
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      const result = await service.impersonate('comp-1', 'admin-1', 'admin@platform.com');

      expect(result.accessToken).toBe('impersonation_token');
      expect(result.refreshToken).toBeNull();
      expect(result.user.id).toBe('user-1');

      expect(mockJwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-1',
          impersonatedBy: 'admin-1',
        }),
        expect.objectContaining({ expiresIn: '30m' }),
      );
    });

    it('should write audit log in target company', async () => {
      const company = { id: 'comp-1', deletedAt: null };
      const adminUser = {
        id: 'user-1',
        email: 'admin@comp1.com',
        role: 'admin',
        companyId: 'comp-1',
        firstName: 'Admin',
        lastName: 'User',
      };

      mockPrisma.company.findUnique.mockResolvedValueOnce(company);
      mockPrisma.user.findFirst.mockResolvedValueOnce(adminUser);
      mockJwtService.sign.mockReturnValue('token');
      mockPrisma.platformAuditLog.create.mockResolvedValueOnce({});
      mockPrisma.auditLog.create.mockResolvedValueOnce({});

      await service.impersonate('comp-1', 'admin-1', 'admin@platform.com');

      expect(mockPrisma.platformAuditLog.create).toHaveBeenCalled();
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-1',
            companyId: 'comp-1',
            action: 'profile_update',
            metadata: expect.objectContaining({ impersonatedBy: 'admin-1' }),
          }),
        }),
      );
    });

    it('should throw UnauthorizedException when company not found', async () => {
      mockPrisma.company.findUnique.mockResolvedValueOnce(null);

      await expect(service.impersonate('comp-1', 'admin-1', 'admin@platform.com')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when no admin user exists', async () => {
      mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 'comp-1', deletedAt: null });
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(service.impersonate('comp-1', 'admin-1', 'admin@platform.com')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getMetrics', () => {
    it('should return platform metrics', async () => {
      const now = new Date();
      jest.useFakeTimers();
      jest.setSystemTime(now);

      const activeSubscriptions = [
        { plan: { price: 4900, tier: 'pro' }, invoices: [{ amount: 4900 }] },
        { plan: { price: 9900, tier: 'enterprise' }, invoices: [] },
      ];

      mockPrisma.subscription.findMany.mockResolvedValueOnce(activeSubscriptions);
      mockPrisma.company.count.mockResolvedValueOnce(100);
      mockPrisma.company.count.mockResolvedValueOnce(80);
      mockPrisma.company.count.mockResolvedValueOnce(10);
      mockPrisma.delivery.count.mockResolvedValueOnce(5000);
      mockPrisma.invoice.groupBy.mockResolvedValueOnce([
        { status: 'paid', _count: { id: 50 }, _sum: { amount: 245000 } },
      ]);
      mockPrisma.company.findMany.mockResolvedValueOnce([
        {
          id: 'c1',
          name: 'Top Co',
          _count: { users: 10, deliveries: 500, vehicles: 5 },
          subscription: { plan: { name: 'Pro', tier: 'pro', price: 4900 }, status: 'active' },
        },
      ]);
      mockPrisma.subscription.count.mockResolvedValueOnce(2);
      mockPrisma.subscription.count.mockResolvedValueOnce(80);

      const result = await service.getMetrics();

      expect(result.mrr).toBe(14800);
      expect(result.totalCompanies).toBe(100);
      expect(result.activeCompanies).toBe(80);
      expect(result.newCompaniesThisMonth).toBe(10);
      expect(result.totalDeliveries).toBe(5000);
      expect(result.churnRate).toBeDefined();
      expect(result.topCompanies).toHaveLength(1);

      jest.useRealTimers();
    });
  });

  describe('getAuditLogs', () => {
    it('should return paginated audit logs', async () => {
      const logs = [
        { id: 'log-1', action: 'login', admin: { id: 'admin-1' }, targetCompany: null },
      ];
      mockPrisma.platformAuditLog.findMany.mockResolvedValueOnce(logs);
      mockPrisma.platformAuditLog.count.mockResolvedValueOnce(1);

      const result = await service.getAuditLogs(1, 20);

      expect(result.data).toEqual(logs);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });

  describe('getAdmins', () => {
    it('should return all platform admins', async () => {
      const admins = [
        {
          id: 'admin-1',
          email: 'a@test.com',
          firstName: 'A',
          lastName: 'B',
          totpEnabled: true,
          isActive: true,
          createdAt: new Date(),
        },
      ];
      mockPrisma.platformAdmin.findMany.mockResolvedValueOnce(admins);

      const result = await service.getAdmins();

      expect(result).toEqual(admins);
    });
  });

  describe('setupAdmin', () => {
    it('should create first admin when none exists', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(null);
      mockPrisma.platformAdmin.create.mockResolvedValueOnce({
        id: 'admin-1',
        email: 'new@admin.com',
        firstName: 'New',
        lastName: 'Admin',
        createdAt: new Date(),
      });

      const result = await service.setupAdmin('new@admin.com', 'StrongPass123!', 'New', 'Admin');

      expect(result.email).toBe('new@admin.com');
      expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass123!', 12);
    });

    it('should throw ConflictException when admin already exists', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.setupAdmin('existing@admin.com', 'pass', 'A', 'B')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('changePassword', () => {
    it('should change password and revoke refresh token', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('new_hashed');
      mockPrisma.platformAdmin.update.mockResolvedValueOnce({});

      await service.changePassword('admin-1', 'OldPass123!', 'NewPass123!');

      expect(bcrypt.compare).toHaveBeenCalledWith('OldPass123!', 'hashed');
      expect(mockPrisma.platformAdmin.update).toHaveBeenCalledWith({
        where: { id: 'admin-1' },
        data: { passwordHash: 'new_hashed', refreshTokenHash: null },
      });
    });

    it('should throw UnauthorizedException when current password is wrong', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
        id: 'admin-1',
        passwordHash: 'hashed',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(
        service.changePassword('admin-1', 'WrongPass123!', 'NewPass123!'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('2FA management', () => {
    describe('generate2fa', () => {
      it('should generate 2FA secret when not enabled', async () => {
        mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
          id: 'admin-1',
          totpEnabled: false,
        });
        mockTotpService.generateSecret.mockResolvedValueOnce({
          secret: 'NEW_SECRET',
          otpauthUrl: 'url',
          qrCode: 'qr',
        });
        mockPrisma.platformAdmin.update.mockResolvedValueOnce({});

        const result = await service.generate2fa('admin-1');

        expect(result.secret).toBe('NEW_SECRET');
        expect(result.qrCode).toBe('qr');
      });

      it('should throw when 2FA already enabled', async () => {
        mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
          id: 'admin-1',
          totpEnabled: true,
        });

        await expect(service.generate2fa('admin-1')).rejects.toThrow(UnauthorizedException);
      });
    });

    describe('verify2faSetup', () => {
      it('should enable 2FA when token is valid', async () => {
        mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
          id: 'admin-1',
          totpSecret: 'SECRET',
        });
        mockTotpService.verifyToken.mockReturnValueOnce(true);
        mockPrisma.platformAdmin.update.mockResolvedValueOnce({});

        const result = await service.verify2faSetup('admin-1', '123456');

        expect(result.message).toBe('2FA enabled successfully');
      });

      it('should throw when token is invalid', async () => {
        mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
          id: 'admin-1',
          totpSecret: 'SECRET',
        });
        mockTotpService.verifyToken.mockReturnValueOnce(false);

        await expect(service.verify2faSetup('admin-1', '123456')).rejects.toThrow(
          UnauthorizedException,
        );
      });
    });

    describe('disable2fa', () => {
      it('should disable 2FA when token is valid', async () => {
        mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce({
          id: 'admin-1',
          totpEnabled: true,
          totpSecret: 'SECRET',
        });
        mockTotpService.verifyToken.mockReturnValueOnce(true);
        mockPrisma.platformAdmin.update.mockResolvedValueOnce({});

        const result = await service.disable2fa('admin-1', '123456');

        expect(result.message).toBe('2FA disabled successfully');
        expect(mockPrisma.platformAdmin.update).toHaveBeenCalledWith({
          where: { id: 'admin-1' },
          data: { totpEnabled: false, totpSecret: null },
        });
      });
    });
  });

  describe('getProfile', () => {
    it('should return admin profile', async () => {
      const admin = {
        id: 'admin-1',
        email: 'admin@test.com',
        firstName: 'A',
        lastName: 'B',
        totpEnabled: true,
        isActive: true,
        createdAt: new Date(),
      };
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(admin);

      const result = await service.getProfile('admin-1');

      expect(result).toEqual(admin);
    });

    it('should throw UnauthorizedException when admin not found', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValueOnce(null);

      await expect(service.getProfile('admin-1')).rejects.toThrow(UnauthorizedException);
    });
  });
});
