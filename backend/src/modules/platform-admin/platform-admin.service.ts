import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TotpService } from '../auth/totp.service';
import { PlatformAdminLoginDto } from './dto/login.dto';
import { PlatformAdminVerify2faDto } from './dto/verify-2fa.dto';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);
  private readonly accessExpiration: jwt.SignOptions['expiresIn'];
  private readonly refreshExpiration: jwt.SignOptions['expiresIn'];
  private readonly tempTokenExpiration: jwt.SignOptions['expiresIn'] = '5m';

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private totpService: TotpService,
  ) {
    this.accessExpiration = this.configService.get<string>('JWT_ACCESS_EXPIRATION', '15m') as jwt.SignOptions['expiresIn'];
    this.refreshExpiration = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d') as jwt.SignOptions['expiresIn'];
  }

  async login(dto: PlatformAdminLoginDto, ip?: string, userAgent?: string) {
    dto.email = dto.email.toLowerCase().trim();
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: dto.email },
    });

    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.prisma.platformAuditLog.create({
      data: {
        adminId: admin.id,
        action: admin.totpEnabled ? 'login_2fa_required' : 'login',
        ip,
        userAgent,
      },
    });

    const tempToken = this.jwtService.sign(
      { sub: admin.id, scope: '2fa_pending' },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        expiresIn: this.tempTokenExpiration,
      },
    );

    if (!admin.totpEnabled) {
      let secret = admin.totpSecret;
      let qrCode = '';
      let otpauthUrl = '';

      if (!secret) {
        const result = await this.totpService.generateSecret(admin.email);
        secret = result.secret;
        qrCode = result.qrCode;
        otpauthUrl = result.otpauthUrl;
        await this.prisma.platformAdmin.update({
          where: { id: admin.id },
          data: { totpSecret: secret },
        });
      } else {
        try {
          qrCode = await this.totpService.generateQrCode(admin.email, secret);
          otpauthUrl = `otpauth://totp/DeliveryTracking:${admin.email}?secret=${secret}&issuer=DeliveryTracking`;
        } catch {}
      }

      return {
        accessToken: '',
        refreshToken: '',
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
        },
        requiresTwoFactor: true,
        requires2faSetup: true,
        tempToken,
        totpSecret: secret,
        qrCode,
        otpauthUrl,
      };
    }

    return {
      accessToken: '',
      refreshToken: '',
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
      },
      requiresTwoFactor: true,
      requires2faSetup: false,
      tempToken,
    };
  }

  async verify2fa(dto: PlatformAdminVerify2faDto, ip?: string, userAgent?: string) {
    let payload: { sub: string; scope: string };
    try {
      payload = this.jwtService.verify<{ sub: string; scope: string }>(dto.tempToken, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired temporary token');
    }

    if (payload.scope !== '2fa_pending') {
      throw new UnauthorizedException('Invalid token scope');
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive || !admin.totpEnabled || !admin.totpSecret) {
      throw new UnauthorizedException('Admin not found or 2FA not enabled');
    }

    const isValid = this.totpService.verifyToken(admin.totpSecret, dto.token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    await this.prisma.platformAuditLog.create({
      data: {
        adminId: admin.id,
        action: 'login_success',
        ip,
        userAgent,
      },
    });

    return this.generateTokens(admin);
  }

  async getTenants() {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        users: {
          where: { deletedAt: null, role: 'admin' },
          select: { id: true, email: true, firstName: true, lastName: true },
          take: 1,
        },
        subscription: {
          select: {
            status: true,
            plan: { select: { name: true, tier: true, price: true } },
            currentPeriodEnd: true,
          },
        },
        _count: {
          select: {
            users: { where: { deletedAt: null } },
            vehicles: { where: { deletedAt: null } },
            drivers: { where: { deletedAt: null } },
            deliveries: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return companies;
  }

  async toggleTenantStatus(companyId: string, adminId: string, ip?: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      include: {
        users: { where: { deletedAt: null }, take: 1, select: { id: true } },
      },
    });

    if (!company) {
      throw new UnauthorizedException('Tenant not found');
    }

    const now = new Date();
    const isCurrentlyDeleted = company.deletedAt !== null;

    await this.prisma.company.update({
      where: { id: companyId },
      data: { deletedAt: isCurrentlyDeleted ? null : now },
    });

    if (!isCurrentlyDeleted) {
      await this.prisma.user.updateMany({
        where: { companyId, deletedAt: null },
        data: { deletedAt: now },
      });
    }

    await this.prisma.platformAuditLog.create({
      data: {
        adminId,
        action: 'tenant_toggle',
        targetCompanyId: companyId,
        metadata: { activated: isCurrentlyDeleted },
        ip,
      },
    });

    return { activated: isCurrentlyDeleted };
  }

  async impersonate(companyId: string, adminId: string, adminEmail: string, ip?: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId, deletedAt: null },
    });

    if (!company) {
      throw new UnauthorizedException('Tenant not found or disabled');
    }

    const adminUser = await this.prisma.user.findFirst({
      where: { companyId, role: 'admin', deletedAt: null },
    });

    if (!adminUser) {
      throw new UnauthorizedException('No admin found for this tenant');
    }

    // Option B: no refresh token for impersonation — only short-lived access token
    // Prevents the bug where a stolen impersonation refresh token could
    // trigger token-reuse detection and revoke the real admin's sessions.
    const accessToken = this.jwtService.sign(
      {
        sub: adminUser.id,
        email: adminUser.email,
        role: adminUser.role,
        companyId: adminUser.companyId,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        type: 'user',
        impersonatedBy: adminId,
      },
      {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        expiresIn: '30m',
      },
    );

    await this.prisma.platformAuditLog.create({
      data: {
        adminId,
        action: 'impersonate',
        targetCompanyId: companyId,
        targetUserId: adminUser.id,
        metadata: { impersonatedAs: adminUser.email },
        ip,
      },
    });

    // Write audit log in target company's own AuditLog as well
    await this.prisma.auditLog.create({
      data: {
        userId: adminUser.id,
        companyId,
        action: 'profile_update',
        metadata: { impersonatedBy: adminId, platformAdminEmail: adminEmail },
        ip,
      },
    }).catch((err: any) => {
      this.logger.error(`Failed to write impersonation audit log for company ${companyId}: ${err.message}`);
    });

    return {
      accessToken,
      refreshToken: null,
      user: {
        id: adminUser.id,
        email: adminUser.email,
        firstName: adminUser.firstName,
        lastName: adminUser.lastName,
        role: adminUser.role,
        companyId: adminUser.companyId,
        type: 'user',
      },
    };
  }

  async getMetrics() {
    const now = new Date();
    const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    const [
      activeSubscriptions,
      totalCompanies,
      activeCompanies,
      newCompaniesThisMonth,
      totalDeliveries,
      invoices,
      companiesWithUsers,
    ] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { status: 'active' },
        select: {
          companyId: true,
          plan: { select: { price: true, tier: true } },
          invoices: {
            where: { status: 'paid', paidAt: { gte: firstOfMonth } },
            select: { amount: true },
          },
        },
      }),
      this.prisma.company.count({ where: { deletedAt: null } }),
      this.prisma.company.count({
        where: {
          deletedAt: null,
          users: { some: { deletedAt: null } },
        },
      }),
      this.prisma.company.count({
        where: { deletedAt: null, createdAt: { gte: firstOfMonth } },
      }),
      this.prisma.delivery.count({
        where: { createdAt: { gte: firstOfMonth } },
      }),
      this.prisma.invoice.groupBy({
        by: ['status'],
        _count: { id: true },
        _sum: { amount: true },
      }),
      this.prisma.company.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          _count: {
            select: {
              users: { where: { deletedAt: null } },
              deliveries: true,
              vehicles: { where: { deletedAt: null } },
            },
          },
          subscription: {
            select: {
              plan: { select: { name: true, tier: true, price: true } },
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);

    const mrr = activeSubscriptions
      .filter((s) => s.plan.tier !== 'free')
      .reduce((sum, s) => sum + s.plan.price, 0);

    const monthlyRevenue = invoices
      .filter((i) => i.status === 'paid')
      .reduce((sum, i) => sum + (i._sum.amount || 0), 0);

    const churnedLastMonth = await this.prisma.subscription.count({
      where: {
        status: 'canceled',
        canceledAt: { gte: firstOfLastMonth, lte: endOfLastMonth },
      },
    });

    const lastMonthActive = await this.prisma.subscription.count({
      where: {
        status: 'active',
        currentPeriodStart: { lte: endOfLastMonth },
        currentPeriodEnd: { gte: firstOfLastMonth },
      },
    });

    const churnRate = lastMonthActive > 0 ? (churnedLastMonth / lastMonthActive) * 100 : 0;

    const topCompanies = companiesWithUsers
      .filter((c) => c.subscription)
      .sort((a, b) => (b._count.deliveries || 0) - (a._count.deliveries || 0))
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        name: c.name,
        users: c._count.users,
        deliveries: c._count.deliveries,
        vehicles: c._count.vehicles,
        plan: c.subscription?.plan.name || 'Free',
        tier: c.subscription?.plan.tier || 'free',
      }));

    const growthData = await this.getMonthlyGrowth();

    return {
      mrr,
      monthlyRevenue,
      totalCompanies,
      activeCompanies,
      newCompaniesThisMonth,
      totalDeliveries,
      activeSubscriptions: activeSubscriptions.length,
      churnRate: Math.round(churnRate * 100) / 100,
      topCompanies,
      growthData,
      invoiceStats: invoices.reduce(
        (acc, i) => {
          acc[i.status] = { count: i._count.id, amount: i._sum.amount || 0 };
          return acc;
        },
        {} as Record<string, { count: number; amount: number }>,
      ),
    };
  }

  private async getMonthlyGrowth() {
    const months: { label: string; start: Date; end: Date }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        start: d,
        end: new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59),
      });
    }

    const results = await Promise.all(
      months.map(async (m) => {
        const [companies, activeSubs, deliveries] = await Promise.all([
          this.prisma.company.count({
            where: { deletedAt: null, createdAt: { lte: m.end } },
          }),
          this.prisma.subscription.count({
            where: {
              status: 'active',
              currentPeriodStart: { lte: m.end },
              currentPeriodEnd: { gte: m.start },
            },
          }),
          this.prisma.delivery.count({
            where: { createdAt: { gte: m.start, lte: m.end } },
          }),
        ]);

        return {
          month: m.label,
          companies,
          activeSubscriptions: activeSubs,
          deliveries,
        };
      }),
    );

    return results;
  }

  async getAuditLogs(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, email: true, firstName: true, lastName: true } },
          targetCompany: { select: { id: true, name: true } },
        },
      }),
      this.prisma.platformAuditLog.count(),
    ]);

    return { data: logs, total, page, totalPages: Math.ceil(total / limit) };
  }

  async getAdmins() {
    return this.prisma.platformAdmin.findMany({
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        totpEnabled: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async setupAdmin(email: string, password: string, firstName: string, lastName: string) {
    const existing = await this.prisma.platformAdmin.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('A super-admin with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    return this.prisma.platformAdmin.create({
      data: { email, passwordHash, firstName, lastName, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
    });
  }

  async changePassword(adminId: string, currentPassword: string, newPassword: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException('Admin not found');

    const isValid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!isValid) throw new UnauthorizedException('Current password is incorrect');

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: { passwordHash, refreshTokenHash: null },
    });
  }

  async verify2faSetupAndLogin(tempToken: string, token: string, ip?: string, userAgent?: string) {
    let payload: { sub: string; scope: string };
    try {
      payload = this.jwtService.verify<{ sub: string; scope: string }>(tempToken, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
        algorithms: ['HS256'],
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired temporary token');
    }

    if (payload.scope !== '2fa_pending') {
      throw new UnauthorizedException('Invalid token scope');
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: payload.sub } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Admin not found');
    }

    if (!admin.totpSecret) {
      throw new UnauthorizedException('2FA not set up. Please reconnect.');
    }

    const isValid = this.totpService.verifyToken(admin.totpSecret, token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid 2FA code');
    }

    if (!admin.totpEnabled) {
      await this.prisma.platformAdmin.update({
        where: { id: admin.id },
        data: { totpEnabled: true },
      });
    }

    await this.prisma.platformAuditLog.create({
      data: {
        adminId: admin.id,
        action: 'login_success',
        ip,
        userAgent,
      },
    });

    return this.generateTokens({
      ...admin,
      totpEnabled: true,
    });
  }

  async generate2fa(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException('Admin not found');
    if (admin.totpEnabled) {
      throw new UnauthorizedException('2FA already enabled. Disable it first to regenerate.');
    }

    const result = await this.totpService.generateSecret(admin.email);
    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: { totpSecret: result.secret },
    });

    return { secret: result.secret, otpauthUrl: result.otpauthUrl, qrCode: result.qrCode };
  }

  async verify2faSetup(adminId: string, token: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin || !admin.totpSecret) throw new UnauthorizedException('2FA not set up');

    const isValid = this.totpService.verifyToken(admin.totpSecret, token);
    if (!isValid) throw new UnauthorizedException('Invalid 2FA token');

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: { totpEnabled: true },
    });

    return { message: '2FA enabled successfully' };
  }

  async disable2fa(adminId: string, token: string) {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: adminId } });
    if (!admin || !admin.totpEnabled) throw new UnauthorizedException('2FA is not enabled');

    const isValid = this.totpService.verifyToken(admin.totpSecret!, token);
    if (!isValid) throw new UnauthorizedException('Invalid 2FA token');

    await this.prisma.platformAdmin.update({
      where: { id: adminId },
      data: { totpEnabled: false, totpSecret: null },
    });

    return { message: '2FA disabled successfully' };
  }

  async getProfile(adminId: string) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        totpEnabled: true,
        isActive: true,
        createdAt: true,
      },
    });
    if (!admin) throw new UnauthorizedException('Admin not found');
    return admin;
  }

  private async generateTokens(admin: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    isActive: boolean;
    totpEnabled: boolean;
  }) {
    const payload: JwtPayload = {
      sub: admin.id,
      email: admin.email,
      role: 'super_admin',
      firstName: admin.firstName,
      lastName: admin.lastName,
      type: 'platform_admin',
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET')!,
      expiresIn: this.accessExpiration,
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET')!,
      expiresIn: this.refreshExpiration,
    });

    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { refreshTokenHash },
    });

    return {
      accessToken,
      refreshToken,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: 'super_admin' as const,
        totpEnabled: admin.totpEnabled,
      },
    };
  }
}
