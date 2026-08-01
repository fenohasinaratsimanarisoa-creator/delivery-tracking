import { PlatformAdminService } from './platform-admin.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

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

describe('PlatformAdminService.login — 2FA optionnelle', () => {
  let service: PlatformAdminService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PlatformAdminService(
      mockPrisma as any,
      mockJwtService as any,
      mockConfigService as any,
      mockTotpService as any,
    );
  });

  const base = { id: 'admin-1', email: 'admin@test.com', firstName: 'A', lastName: 'B', isActive: true };

  it('logs in with password only when totpEnabled=false (no 2FA step)', async () => {
    mockPrisma.platformAdmin.findUnique.mockResolvedValue({ ...base, totpEnabled: false, passwordHash });

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
    mockPrisma.platformAdmin.findUnique.mockResolvedValue({ ...base, totpEnabled: true, passwordHash });

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
    mockPrisma.platformAdmin.findUnique.mockResolvedValue({ ...base, totpEnabled: false, passwordHash });

    await expect(service.login({ email: 'admin@test.com', password: 'wrong' })).rejects.toThrow(
      'Invalid credentials',
    );
  });
});
