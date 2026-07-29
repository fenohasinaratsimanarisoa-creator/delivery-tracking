import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdateEmailDto,
  UpdateAvatarDto,
} from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateUserDto) {
    dto.email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const validRoles: string[] = ['admin', 'dispatcher', 'driver', 'client'];
    if (!validRoles.includes(dto.role)) {
      throw new BadRequestException('Invalid user role');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    if (dto.role === 'driver') {
      if (dto.vehicleId) {
        const vehicle = await this.prisma.vehicle.findFirst({
          where: { id: dto.vehicleId, companyId, deletedAt: null },
        });
        if (!vehicle) {
          throw new BadRequestException('Vehicle not found in your company');
        }
        const alreadyAssigned = await this.prisma.driver.findFirst({
          where: { vehicleId: dto.vehicleId, deletedAt: null },
        });
        if (alreadyAssigned) {
          throw new ConflictException('Vehicle is already assigned to another driver');
        }
      }
      if (dto.licenseNumber) {
        const existingLic = await this.prisma.driver.findFirst({
          where: { companyId, licenseNumber: dto.licenseNumber, deletedAt: null },
        });
        if (existingLic) {
          throw new ConflictException('License number already exists');
        }
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          role: dto.role,
          companyId,
        },
      });

      if (dto.role === 'driver') {
        const existingDriver = await tx.driver.findFirst({
          where: { companyId, email: dto.email, deletedAt: null },
        });
        if (existingDriver) {
          const updateData: any = { userId: user.id };
          if (dto.licenseNumber) updateData.licenseNumber = dto.licenseNumber;
          if (dto.vehicleId) updateData.vehicleId = dto.vehicleId;
          await tx.driver.update({
            where: { id: existingDriver.id },
            data: updateData,
          });
        } else {
          const driverData: any = {
            firstName: dto.firstName,
            lastName: dto.lastName,
            email: dto.email,
            phone: dto.phone,
            licenseNumber: dto.licenseNumber || `DRV-${user.id.slice(0, 8)}`,
            companyId,
            userId: user.id,
          };
          if (dto.vehicleId) driverData.vehicleId = dto.vehicleId;
          await tx.driver.create({ data: driverData });
        }
      }

      return user;
    });

    return {
      id: result.id,
      email: result.email,
      firstName: result.firstName,
      lastName: result.lastName,
      phone: result.phone,
      role: result.role,
      isActive: result.isActive,
      companyId: result.companyId,
      createdAt: result.createdAt,
    };
  }

  async findAll(companyId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { companyId, deletedAt: null };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          companyId: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string, companyId?: string, currentUserId?: string, currentUserRole?: string) {
    if (currentUserId && currentUserRole && id !== currentUserId && currentUserRole !== 'admin' && currentUserRole !== 'dispatcher') {
      throw new NotFoundException('User not found');
    }
    const where: any = { id, deletedAt: null };
    if (companyId) where.companyId = companyId;
    const user = await this.prisma.user.findFirst({
      where,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        companyId: true,
        createdAt: true,
        avatarUrl: true,
        googleId: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  }

  async getPreferences(userId: string) {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
    });
    if (!prefs) {
      return this.prisma.userPreferences.create({
        data: { userId },
      });
    }
    return prefs;
  }

  async updatePreferences(userId: string, data: Record<string, boolean>) {
    const allowed = [
      'emailDeliveryStatus',
      'emailFuelAnomaly',
      'emailDeliveryDelayed',
      'emailMaintenanceDue',
      'emailSystem',
      'inAppDeliveryStatus',
      'inAppFuelAnomaly',
      'inAppDeliveryDelayed',
      'inAppMaintenanceDue',
      'inAppSystem',
    ];
    const update: Record<string, boolean> = {};
    for (const key of allowed) {
      if (typeof data[key] === 'boolean') {
        update[key] = data[key];
      }
    }
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...update },
      update,
    });
    return this.prisma.userPreferences.findUnique({ where: { userId } });
  }

  async findByCompany(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        companyId: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(companyId: string, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (existing) throw new ConflictException('Email already in use');
    }

    const targetRole = dto.role || user.role;
    if (targetRole === 'driver') {
      if (dto.vehicleId) {
        const vehicle = await this.prisma.vehicle.findFirst({
          where: { id: dto.vehicleId, companyId, deletedAt: null },
        });
        if (!vehicle) throw new BadRequestException('Vehicle not found in your company');
        const alreadyAssigned = await this.prisma.driver.findFirst({
          where: { vehicleId: dto.vehicleId, deletedAt: null, userId: { not: id } },
        });
        if (alreadyAssigned) throw new ConflictException('Vehicle is already assigned to another driver');
      }
      if (dto.licenseNumber) {
        const existingLic = await this.prisma.driver.findFirst({
          where: { companyId, licenseNumber: dto.licenseNumber, deletedAt: null },
        });
        if (existingLic && existingLic.userId !== id) {
          throw new ConflictException('License number already exists');
        }
      }
    }

    const data: any = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          companyId: true,
          createdAt: true,
        },
      });

      if (targetRole === 'driver' && (dto.vehicleId !== undefined || dto.licenseNumber !== undefined)) {
        const existingDriver = await tx.driver.findFirst({
          where: { companyId, userId: id, deletedAt: null },
        });
        const driverData: any = {};
        if (dto.vehicleId !== undefined) driverData.vehicleId = dto.vehicleId;
        if (dto.licenseNumber !== undefined) driverData.licenseNumber = dto.licenseNumber;

        if (existingDriver) {
          await tx.driver.update({
            where: { id: existingDriver.id },
            data: driverData,
          });
        } else {
          await tx.driver.create({
            data: {
              firstName: updatedUser.firstName,
              lastName: updatedUser.lastName,
              email: updatedUser.email,
              phone: updatedUser.phone || undefined,
              licenseNumber: dto.licenseNumber || `DRV-${id.slice(0, 8)}`,
              companyId,
              userId: id,
              ...(dto.vehicleId ? { vehicleId: dto.vehicleId } : {}),
            },
          });
        }
      }

      return updatedUser;
    });

    return result;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: dto,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        companyId: true,
        createdAt: true,
        avatarUrl: true,
      },
    });
  }

  async updateEmail(userId: string, newEmail: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    if (newEmail === user.email) {
      throw new BadRequestException('New email must be different from current email');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: newEmail },
    });
    if (existing) throw new ConflictException('Email already in use');

    // TODO: Send email verification to new email
    // For now, just update the email
    return this.prisma.user.update({
      where: { id: userId },
      data: { email: newEmail },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        companyId: true,
        createdAt: true,
        avatarUrl: true,
      },
    });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmPassword) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const isValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 12);

    // Update password and revoke all refresh tokens (logout all sessions)
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          refreshTokenHash: null,
        },
      }),
      // Delete all user sessions (they'll be invalidated on next use)
      this.prisma.userSession.deleteMany({
        where: { userId },
      }),
    ]);

    return { message: 'Password changed successfully. You have been logged out from all devices.' };
  }

  async updateAvatar(userId: string, dto: UpdateAvatarDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: dto.avatarUrl },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        companyId: true,
        createdAt: true,
        avatarUrl: true,
      },
    });
  }

  async exportPersonalData(userId: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isActive: true,
        createdAt: true,
        avatarUrl: true,
        preferences: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [sessions, deliveries, notifications, auditLogs] = await Promise.all([
      this.prisma.userSession.findMany({
        where: { userId },
        select: { device: true, ip: true, location: true, lastActivity: true, expiresAt: true },
      }),
      this.prisma.delivery.findMany({
        where: { OR: [{ assignedDriverId: userId }, { clientId: userId }] },
        take: 50,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: { type: true, title: true, message: true, readAt: true, createdAt: true },
      }),
      this.prisma.auditLog.findMany({
        where: { userId },
        take: 50,
        orderBy: { createdAt: 'desc' },
        select: { action: true, metadata: true, ip: true, createdAt: true },
      }),
    ]);

    return {
      exportedAt: new Date().toISOString(),
      account: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        preferences: user.preferences,
      },
      sessions,
      deliveries: deliveries.map((d) => ({
        id: d.id,
        title: d.title,
        status: d.status,
        pickupAddress: d.pickupAddress,
        deliveryAddress: d.deliveryAddress,
        createdAt: d.createdAt,
      })),
      notifications,
      auditLogs,
    };
  }

  async anonymizeUser(userId: string, companyId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          deletedAt: now,
          isActive: false,
          refreshTokenHash: null,
          email: `deleted-${userId.slice(0, 8)}@anon.deliverytrack.app`,
          firstName: '[Deleted]',
          lastName: '[Deleted]',
          phone: null,
          avatarUrl: null,
          googleId: null,
          totpSecret: null,
          totpEnabled: false,
        },
      }),
      this.prisma.userSession.deleteMany({ where: { userId } }),
      this.prisma.userPreferences.deleteMany({ where: { userId } }),
      this.prisma.notification.updateMany({
        where: { userId },
        data: { userId: null, message: '[Deleted]' },
      }),
    ]);

    Logger.log(`User ${userId} anonymized successfully`, 'UsersService');
  }

  async remove(companyId: string, id: string, currentUserId: string) {
    if (id === currentUserId) {
      throw new ConflictException('You cannot delete your own account');
    }

    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        refreshTokenHash: null,
      },
    });
  }
}
