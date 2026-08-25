import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyScopedContext } from '../../common/tenant/company-scoped-context';
import { VehicleAssignmentHistoryService } from '../../common/vehicle-assignment/vehicle-assignment-history.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto, ChangePasswordDto, UpdateAvatarDto } from './dto/update-profile.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private assignmentHistory: VehicleAssignmentHistoryService,
  ) {}

  async create(companyId: string, dto: CreateUserDto) {
    dto.email = dto.email.toLowerCase().trim();
    // Unicité GLOBALE de l'email : le middleware tenant injecterait companyId
    // dans le where d'un findUnique, ce qui laisserait passer un email déjà
    // utilisé par une AUTRE entreprise (→ P2002 → 500). On désactive le
    // contexte pour cette requête précise, comme dans invitations.service.ts.
    const existing = await CompanyScopedContext.run(null, () =>
      this.prisma.user.findUnique({
        where: { email: dto.email },
      }),
    );
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const validRoles: string[] = ['admin', 'dispatcher', 'driver', 'client'];
    if (!validRoles.includes(dto.role)) {
      throw new BadRequestException('Invalid user role');
    }

    // Coût 12 aligné sur register / changePassword / resetPassword (avant : 10,
    // ~4× moins cher à casser hors-ligne en cas de fuite DB).
    const passwordHash = await bcrypt.hash(dto.password, 12);

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
          if (dto.vehicleId) {
            await this.assignmentHistory.assign(tx, {
              companyId,
              driverId: existingDriver.id,
              vehicleId: dto.vehicleId,
            });
          }
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
          const createdDriver = await tx.driver.create({ data: driverData });
          if (dto.vehicleId) {
            await this.assignmentHistory.assign(tx, {
              companyId,
              driverId: createdDriver.id,
              vehicleId: dto.vehicleId,
            });
          }
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
    if (
      currentUserId &&
      currentUserRole &&
      id !== currentUserId &&
      currentUserRole !== 'admin' &&
      currentUserRole !== 'dispatcher'
    ) {
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
    // Unicité GLOBALE de l'email : le middleware tenant injecterait companyId dans
    // le where d'un findUnique, ce qui ferait manquer un email déjà utilisé par une
    // AUTRE entreprise (→ P2002 → 500 au create). Même pattern que create()/update()/
    // updateEmail() et invitations.service.ts : on désactive le contexte pour cette
    // requête précise (méthode actuellement utilisée hors flux HTTP — cohérence
    // conservée pour tout futur appel depuis une route scopée).
    return CompanyScopedContext.run(null, () =>
      this.prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } }),
    );
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

  async update(companyId: string, id: string, dto: UpdateUserDto, currentUserId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== user.email) {
      const existing = await CompanyScopedContext.run(null, () =>
        this.prisma.user.findUnique({
          where: { email: dto.email },
        }),
      );
      if (existing) throw new ConflictException('Email already in use');
    }

    // Garde-fou 1 : un admin ne peut pas rétrograder ni désactiver SON PROPRE compte
    // admin (même logique que remove() qui bloque déjà l'auto-suppression).
    if (id === currentUserId && user.role === 'admin') {
      const demotingSelf = dto.role !== undefined && dto.role !== 'admin';
      const deactivatingSelf = dto.isActive === false;
      if (demotingSelf || deactivatingSelf) {
        throw new ConflictException(
          'You cannot demote or deactivate your own admin account — ask another admin to do it',
        );
      }
    }

    // Garde-fou 2 : il doit toujours rester au moins un admin actif dans la société.
    // Si l'utilisateur ciblé est un admin actif sur le point d'être rétrogradé ou
    // désactivé, on compte les autres admins actifs — 0 => refus.
    if (user.role === 'admin' && user.isActive) {
      const demoting = dto.role !== undefined && dto.role !== 'admin';
      const deactivating = dto.isActive === false;
      if (demoting || deactivating) {
        const otherActiveAdmins = await this.prisma.user.count({
          where: { companyId, role: 'admin', isActive: true, deletedAt: null, id: { not: id } },
        });
        if (otherActiveAdmins === 0) {
          throw new BadRequestException('Cannot remove the last active admin of this company');
        }
      }
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
        if (alreadyAssigned)
          throw new ConflictException('Vehicle is already assigned to another driver');
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
    // Normalisation de l'email, comme à la création : sans trim/toLowerCase, la
    // contrainte Postgres (sensible à la casse) laissait coexister User@X.com et
    // user@x.com → doublons et confusion de comptes.
    if (dto.email !== undefined) data.email = dto.email.toLowerCase().trim();
    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 12);
      // Réinitialisation du mot de passe PAR UN ADMIN : on révoque TOUTES les
      // sessions de l'utilisateur (refreshTokenHash purgé + lignes UserSession
      // supprimées), sinon un compte compromis resterait connecté 7 jours après
      // le changement — la même garantie que changePassword() (auto-service).
      data.refreshTokenHash = null;
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

      // Mot de passe modifié → purge des sessions existantes (refresh tokens
      // morts). Les access tokens meurent à leur expiration (≤ 15 min).
      if (dto.password) {
        await tx.userSession.deleteMany({ where: { userId: id } });
      }

      if (targetRole === 'driver') {
        // On garantit l'existence d'un record Driver pour TOUT utilisateur passé
        // chauffeur (même sans véhicule/licence fournis) : avant, un rôle 'driver'
        // sans vehicleId ni licenseNumber ne créait AUCUN record → affectation
        // véhicule impossible et findDriverByUserId échouait.
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
          if (dto.vehicleId !== undefined) {
            if (dto.vehicleId === null) {
              await this.assignmentHistory.unassign(tx, { driverId: existingDriver.id });
            } else {
              await this.assignmentHistory.assign(tx, {
                companyId,
                driverId: existingDriver.id,
                vehicleId: dto.vehicleId,
              });
            }
          }
        } else {
          const createdDriver = await tx.driver.create({
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
          if (dto.vehicleId) {
            await this.assignmentHistory.assign(tx, {
              companyId,
              driverId: createdDriver.id,
              vehicleId: dto.vehicleId,
            });
          }
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

  async updateEmail(userId: string, newEmail: string, currentPassword?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('User not found');

    // Sécurité : changer l'email = changer l'identifiant de connexion. On exige
    // la preuve de possession du compte : le mot de passe courant pour un compte
    // local (googleId null), l'authentification Google OAuth étant déjà la preuve
    // (email vérifié par Google) pour les comptes créés via OAuth — ceux-ci ont
    // un mot de passe aléatoire inconnu (validateGoogleUser).
    if (!user.googleId) {
      if (!currentPassword) {
        throw new UnauthorizedException('Current password is required to change email');
      }
      const isValid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValid) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    }

    // Normalisation (trim + minuscules) : la contrainte d'unicité Postgres est
    // sensible à la casse — sans cela, User@X.com et user@x.com coexistaient.
    newEmail = newEmail.toLowerCase().trim();
    if (newEmail === user.email) {
      throw new BadRequestException('New email must be different from current email');
    }

    const existing = await CompanyScopedContext.run(null, () =>
      this.prisma.user.findUnique({
        where: { email: newEmail },
      }),
    );
    if (existing) throw new ConflictException('Email already in use');

    // TODO: Send verification email to the NEW email (preuve de possession de la
    // nouvelle adresse). Pour l'instant le changement est immédiat — la preuve
    // demandée est le mot de passe courant (ou la session OAuth Google), pas la
    // propriété du nouvel email. Limitation connue, documentée dans l'audit
    // global de fiabilité (AUDIT_GLOBAL_FIABILITE_2026-08-19.md, point mineur 4).
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

    // Garde-fou : on ne peut pas supprimer le dernier admin actif de la société
    // (l'auto-suppression est déjà bloquée séparément ci-dessus).
    if (user.role === 'admin' && user.isActive) {
      const otherActiveAdmins = await this.prisma.user.count({
        where: { companyId, role: 'admin', isActive: true, deletedAt: null, id: { not: id } },
      });
      if (otherActiveAdmins === 0) {
        throw new BadRequestException('Cannot remove the last active admin of this company');
      }
    }

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
