import { PlatformAdminService } from './platform-admin.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuditAction } from '@prisma/client';

const PASSWORD = 'mandriMena45!';
const passwordHash = bcrypt.hashSync(PASSWORD, 12);

const mockPrisma = {
  platformAdmin: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  platformAuditLog: {
    create: jest.fn(),
  },
  company: {
    findUnique: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn(() => 'signed-token'),
  verify: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, d?: string) => {
    if (key === 'JWT_ACCESS_SECRET') return 'access-secret';
    if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
    return d;
  }),
};

const mockTotpService = {
  generateSecret: jest.fn(),
  generateQrCode: jest.fn(),
  verifyToken: jest.fn(),
};

function buildRedisMock() {
  return {
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
    del: jest.fn().mockResolvedValue(1),
  };
}

describe('PlatformAdminService.login — 2FA optionnelle', () => {
  let service: PlatformAdminService;
  let redis: ReturnType<typeof buildRedisMock>;

  beforeEach(() => {
    jest.clearAllMocks();
    redis = buildRedisMock();
    service = new PlatformAdminService(
      mockPrisma as any,
      mockJwtService as any,
      mockConfigService as any,
      mockTotpService as any,
      redis as any,
    );
  });

  const base = {
    id: 'admin-1',
    email: 'admin@test.com',
    firstName: 'A',
    lastName: 'B',
    isActive: true,
  };

  it('logs in with password only when totpEnabled=false (no 2FA step)', async () => {
    mockPrisma.platformAdmin.findUnique.mockResolvedValue({
      ...base,
      totpEnabled: false,
      passwordHash,
    });

    const result = (await service.login({ email: 'admin@test.com', password: PASSWORD })) as any;

    expect(result.requiresTwoFactor).toBeUndefined();
    expect(result.accessToken).toBe('signed-token');
    expect(result.admin.email).toBe('admin@test.com');
    expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'login' }) }),
    );
    // La 2FA n'est jamais requise pour un compte désactivé.
    expect(result).not.toHaveProperty('tempToken');
  });

  it('still requires 2FA when totpEnabled=true', async () => {
    mockPrisma.platformAdmin.findUnique.mockResolvedValue({
      ...base,
      totpEnabled: true,
      passwordHash,
    });

    const result = (await service.login({ email: 'admin@test.com', password: PASSWORD })) as any;

    expect(result.requiresTwoFactor).toBe(true);
    expect(result.requires2faSetup).toBe(false);
    expect(result.tempToken).toBe('signed-token');
    expect(result.accessToken).toBe('');
    expect(mockPrisma.platformAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'login_2fa_required' }) }),
    );
  });

  it('throws Invalid credentials on wrong password', async () => {
    mockPrisma.platformAdmin.findUnique.mockResolvedValue({
      ...base,
      totpEnabled: false,
      passwordHash,
    });

    await expect(service.login({ email: 'admin@test.com', password: 'wrong' })).rejects.toThrow(
      'Invalid credentials',
    );
  });

  describe('durcissement login (audit 2026-08-25 N.1)', () => {
    it('compte les échecs dans Redis avec une clé admin_login_fail hachée puis purge au succès', async () => {
      mockPrisma.platformAdmin.findUnique
        // Échec : mauvais mot de passe.
        .mockResolvedValueOnce({ ...base, totpEnabled: false, passwordHash })
        // Succès ensuite.
        .mockResolvedValueOnce({ ...base, totpEnabled: false, passwordHash });

      await expect(service.login({ email: 'admin@test.com', password: 'wrong' })).rejects.toThrow(
        'Invalid credentials',
      );
      expect(redis.incr).toHaveBeenCalledWith(
        expect.stringMatching(/^admin_login_fail:[0-9a-f]{32}$/),
      );
      expect(redis.expire).toHaveBeenCalledWith(expect.stringMatching(/^admin_login_fail:/), 900);

      await service.login({ email: 'admin@test.com', password: PASSWORD });
      expect(redis.del).toHaveBeenCalledWith(expect.stringMatching(/^admin_login_fail:/));
    });

    it("refuse le login d'un compte verrouillé sans bcrypt.compare ni accès DB", async () => {
      redis.get.mockResolvedValue('15');

      await expect(service.login({ email: 'admin@test.com', password: PASSWORD })).rejects.toThrow(
        'Too many failed login attempts',
      );
      expect(mockPrisma.platformAdmin.findUnique).not.toHaveBeenCalled();
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('égalise le temps de réponse quand l’email est inconnu (bcrypt.compare sur hash factice)', async () => {
      mockPrisma.platformAdmin.findUnique.mockResolvedValue(null);
      const compareSpy = jest.spyOn(bcrypt, 'compare');

      await expect(
        service.login({ email: 'ghost@test.com', password: 'whatever' }),
      ).rejects.toThrow('Invalid credentials');

      // Le compare a bien été appelé malgré l'admin inexistant (anti-énumération).
      expect(compareSpy).toHaveBeenCalled();
      const [plainArg] = compareSpy.mock.calls[0];
      expect(plainArg).toBe('whatever');
    });

    it('n’applique AUCUN lockout quand Redis est indisponible (null) — jamais bloquant', async () => {
      const noRedisService = new PlatformAdminService(
        mockPrisma as any,
        mockJwtService as any,
        mockConfigService as any,
        mockTotpService as any,
        null,
      );
      mockPrisma.platformAdmin.findUnique.mockResolvedValue({
        ...base,
        totpEnabled: false,
        passwordHash,
      });

      const result = (await noRedisService.login({
        email: 'admin@test.com',
        password: PASSWORD,
      })) as any;
      expect(result.accessToken).toBe('signed-token');
      expect(redis.incr).not.toHaveBeenCalled();
    });
  });

  it('impersonate() writes the target tenant AuditLog with action=admin_impersonation (not profile_update)', async () => {
    mockPrisma.company.findUnique.mockResolvedValueOnce({ id: 'company-1', name: 'Tenant A' });
    mockPrisma.user.findFirst.mockResolvedValueOnce({
      id: 'user-admin',
      email: 'admin@tenant.com',
      role: 'admin',
      companyId: 'company-1',
      firstName: 'Admin',
      lastName: 'Tenant',
    });
    mockPrisma.auditLog.create.mockResolvedValue({});

    await service.impersonate('company-1', 'platform-admin-1', 'platform@admin.com', '1.2.3.4');

    console.log(
      `[impersonate] auditLog.create appelé avec action = ${mockPrisma.auditLog.create.mock.calls[0][0].data.action}`,
    );

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-admin',
          companyId: 'company-1',
          action: AuditAction.admin_impersonation,
          metadata: {
            impersonatedBy: 'platform-admin-1',
            platformAdminEmail: 'platform@admin.com',
          },
          ip: '1.2.3.4',
        }),
      }),
    );
    // L'ancien libellé générique ne doit plus être utilisé pour l'impersonation.
    expect(mockPrisma.auditLog.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'profile_update' }),
      }),
    );
  });
});
