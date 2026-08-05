import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VehicleAssignmentHistoryService } from '../../common/vehicle-assignment/vehicle-assignment-history.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateProfileDto,
  ChangePasswordDto,
  UpdateEmailDto,
  UpdateAvatarDto,
} from './dto/update-profile.dto';

import { Prisma } from '@prisma/client';

jest.mock('bcrypt');

// Simulated Prisma error classes since Prisma.PrismaClientKnownRequestError is not directly instantiable in test
class MockPrismaClientKnownRequestError extends Error {
  code: string;
  meta: any;
  constructor(message: string, code: string, meta?: any) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
    this.code = code;
    this.meta = meta;
  }
}

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  driver: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  vehicle: {
    findFirst: jest.fn(),
  },
  vehicleAssignmentHistory: {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    create: jest.fn(),
  },
  userSession: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) return Promise.all(arg);
    return Promise.resolve(arg);
  }),
};

describe('UsersService', () => {
  let service: UsersService;
  let prisma: PrismaService;

  beforeEach(async () => {
    jest.clearAllMocks();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
        VehicleAssignmentHistoryService,
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('create', () => {
    const dto: CreateUserDto = {
      email: 'new@test.com',
      password: 'StrongPass123!',
      firstName: 'John',
      lastName: 'Doe',
      role: 'dispatcher',
      phone: '+1234567890',
    };

    it('should create a user and return without password', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.create.mockResolvedValueOnce({
        id: 'user-1',
        email: 'new@test.com',
        firstName: 'John',
        lastName: 'Doe',
        phone: '+1234567890',
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });

      const result = await service.create('comp-1', dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'new@test.com' },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith('StrongPass123!', 10);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(result).not.toHaveProperty('passwordHash');
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-user' });

      await expect(service.create('comp-1', dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid role', async () => {
      const invalidDto = { ...dto, role: 'invalid_role' as any };

      await expect(service.create('comp-1', invalidDto)).rejects.toThrow(BadRequestException);
    });

    it('should throw ConflictException when licenseNumber already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'existing-driver' });

      const driverDto: CreateUserDto = { ...dto, role: 'driver', email: 'driver@test.com', licenseNumber: 'EXISTING-LIC-123' };

      await expect(
        service.create('comp-1', driverDto),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when vehicleId does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      const driverDto: CreateUserDto = { ...dto, role: 'driver', email: 'driver2@test.com', vehicleId: 'nonexistent-vehicle' };

      await expect(
        service.create('comp-1', driverDto),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when vehicleId is already assigned to another driver', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1', companyId: 'comp-1' });
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'other-driver' });

      const driverDto: CreateUserDto = { ...dto, role: 'driver', email: 'driver3@test.com', vehicleId: 'vehicle-1' };

      await expect(
        service.create('comp-1', driverDto),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const users = [
        {
          id: 'u1',
          email: 'a@test.com',
          firstName: 'A',
          lastName: 'B',
          role: 'dispatcher',
          isActive: true,
          companyId: 'comp-1',
          createdAt: new Date(),
        },
        {
          id: 'u2',
          email: 'b@test.com',
          firstName: 'C',
          lastName: 'D',
          role: 'driver',
          isActive: true,
          companyId: 'comp-1',
          createdAt: new Date(),
        },
      ];
      mockPrisma.user.findMany.mockResolvedValueOnce(users);
      mockPrisma.user.count.mockResolvedValueOnce(2);

      const result = await service.findAll('comp-1', 1, 20);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { companyId: 'comp-1', deletedAt: null },
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: expect.any(Object),
      });
      expect(result.data).toEqual(users);
      expect(result.meta).toEqual({ total: 2, page: 1, limit: 20, totalPages: 1 });
    });

    it('should calculate correct totalPages', async () => {
      mockPrisma.user.findMany.mockResolvedValueOnce([]);
      mockPrisma.user.count.mockResolvedValueOnce(45);

      const result = await service.findAll('comp-1', 1, 20);

      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('findById', () => {
    it('should return user when found', async () => {
      const user = {
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
        avatarUrl: null,
        googleId: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const result = await service.findById('user-1', 'comp-1');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', companyId: 'comp-1', deletedAt: null },
        select: expect.any(Object),
      });
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(service.findById('user-1', 'comp-1')).rejects.toThrow(NotFoundException);
    });

    it('should not filter by companyId when not provided', async () => {
      const user = {
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        role: 'admin',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
        avatarUrl: null,
        googleId: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      await service.findById('user-1');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
        select: expect.any(Object),
      });
    });

    it('should allow admin to view any user', async () => {
      const user = {
        id: 'other-user', email: 'other@test.com', firstName: 'Other',
        lastName: 'User', role: 'driver', isActive: true,
        companyId: 'comp-1', createdAt: new Date(),
        avatarUrl: null, googleId: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const result = await service.findById('other-user', 'comp-1', 'admin-1', 'admin');
      expect(result).toEqual(user);
    });

    it('should allow dispatcher to view any user', async () => {
      const user = {
        id: 'other-user', email: 'other@test.com', firstName: 'Other',
        lastName: 'User', role: 'driver', isActive: true,
        companyId: 'comp-1', createdAt: new Date(),
        avatarUrl: null, googleId: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const result = await service.findById('other-user', 'comp-1', 'disp-1', 'dispatcher');
      expect(result).toEqual(user);
    });

    it('should allow user to view their own profile', async () => {
      const user = {
        id: 'driver-1', email: 'driver@test.com', firstName: 'Driver',
        lastName: 'User', role: 'driver', isActive: true,
        companyId: 'comp-1', createdAt: new Date(),
        avatarUrl: null, googleId: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(user);

      const result = await service.findById('driver-1', 'comp-1', 'driver-1', 'driver');
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when driver tries to view another user', async () => {
      await expect(
        service.findById('other-user', 'comp-1', 'driver-1', 'driver'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when client tries to view another user', async () => {
      await expect(
        service.findById('other-user', 'comp-1', 'client-1', 'client'),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.user.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    it('should return user by email', async () => {
      const user = { id: 'user-1', email: 'test@test.com', passwordHash: 'hash' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);

      const result = await service.findByEmail('test@test.com');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
      expect(result).toEqual(user);
    });
  });

  describe('findByCompany', () => {
    it('should return users for company', async () => {
      const users = [
        {
          id: 'u1',
          email: 'a@test.com',
          firstName: 'A',
          lastName: 'B',
          role: 'dispatcher',
          isActive: true,
          companyId: 'comp-1',
        },
      ];
      mockPrisma.user.findMany.mockResolvedValueOnce(users);

      const result = await service.findByCompany('comp-1');

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { companyId: 'comp-1', deletedAt: null },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(users);
    });
  });

  describe('update', () => {
    const updateDto: UpdateUserDto = {
      firstName: 'Updated',
      lastName: 'Name',
      email: 'updated@test.com',
    };

    it('should update user', async () => {
      const existingUser = {
        id: 'user-1',
        email: 'old@test.com',
        companyId: 'comp-1',
        deletedAt: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        email: 'updated@test.com',
        firstName: 'Updated',
        lastName: 'Name',
        phone: null,
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });

      const result = await service.update('comp-1', 'user-1', updateDto, 'current-user');

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', companyId: 'comp-1', deletedAt: null },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'Updated', lastName: 'Name', email: 'updated@test.com' },
        select: expect.any(Object),
      });
      expect(result.email).toBe('updated@test.com');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(service.update('comp-1', 'user-1', updateDto, 'current-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when email already in use by another user', async () => {
      const existingUser = {
        id: 'user-1',
        email: 'old@test.com',
        companyId: 'comp-1',
        deletedAt: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'other-user' });

      await expect(service.update('comp-1', 'user-1', updateDto, 'current-user')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should hash password when provided', async () => {
      const existingUser = {
        id: 'user-1',
        email: 'old@test.com',
        companyId: 'comp-1',
        deletedAt: null,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        email: 'old@test.com',
        firstName: 'Updated',
        lastName: 'Name',
        phone: null,
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });

      await service.update('comp-1', 'user-1', { ...updateDto, password: 'NewPass123!' }, 'current-user');

      expect(bcrypt.hash).toHaveBeenCalledWith('NewPass123!', 10);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed_password' }),
        }),
      );
    });

    it('should assign vehicle to existing driver', async () => {
      const existingUser = {
        id: 'user-drv',
        email: 'driver@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'driver',
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1', companyId: 'comp-1' });
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-drv',
        email: 'driver@test.com',
        firstName: 'Driver',
        lastName: 'Test',
        phone: null,
        role: 'driver',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-1', userId: 'user-drv', companyId: 'comp-1' });
      mockPrisma.driver.update.mockResolvedValueOnce({ id: 'driver-1', vehicleId: 'vehicle-1' });

      const result = await service.update('comp-1', 'user-drv', { vehicleId: 'vehicle-1' }, 'current-user');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { vehicleId: 'vehicle-1' },
      });
      expect(result).toBeDefined();
    });

    it('should assign vehicle to user being promoted to driver (no driver record yet)', async () => {
      const existingUser = {
        id: 'user-new-drv',
        email: 'newdrv@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'dispatcher',
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-2', companyId: 'comp-1' });
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-new-drv',
        email: 'newdrv@test.com',
        firstName: 'New',
        lastName: 'Driver',
        phone: null,
        role: 'driver',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);
      mockPrisma.driver.create.mockResolvedValueOnce({ id: 'driver-new', userId: 'user-new-drv', vehicleId: 'vehicle-2' });

      const result = await service.update('comp-1', 'user-new-drv', { role: 'driver', vehicleId: 'vehicle-2' }, 'current-user');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.driver.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'user-new-drv', vehicleId: 'vehicle-2' }),
        }),
      );
      expect(result).toBeDefined();
    });

    it('should throw ConflictException when vehicle is already assigned to another driver', async () => {
      const existingUser = {
        id: 'user-drv-2',
        email: 'driver2@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'driver',
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1', companyId: 'comp-1' });
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'other-driver', userId: 'other-user', vehicleId: 'vehicle-1' });

      await expect(
        service.update('comp-1', 'user-drv-2', { vehicleId: 'vehicle-1' }, 'current-user'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when licenseNumber is taken by another driver', async () => {
      const existingUser = {
        id: 'user-drv-3',
        email: 'driver3@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'driver',
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'other-driver-lic', userId: 'other-user', licenseNumber: 'LIC-999' });

      await expect(
        service.update('comp-1', 'user-drv-3', { licenseNumber: 'LIC-999' }, 'current-user'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should allow keeping the same licenseNumber on update', async () => {
      const existingUser = {
        id: 'user-drv-4',
        email: 'driver4@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'driver',
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(existingUser);
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-4', userId: 'user-drv-4', licenseNumber: 'LIC-777' });
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-drv-4',
        email: 'driver4@test.com',
        firstName: 'Driver',
        lastName: 'Four',
        phone: null,
        role: 'driver',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });
      mockPrisma.driver.findFirst.mockResolvedValueOnce({ id: 'driver-4', userId: 'user-drv-4', companyId: 'comp-1' });
      mockPrisma.driver.update.mockResolvedValueOnce({ id: 'driver-4', licenseNumber: 'LIC-777' });

      const result = await service.update('comp-1', 'user-drv-4', { licenseNumber: 'LIC-777' }, 'current-user');

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-4' },
        data: { licenseNumber: 'LIC-777' },
      });
      expect(result).toBeDefined();
    });

    it('(a) rejects an admin deactivating their own account (last active admin)', async () => {
      const admin = {
        id: 'admin-1',
        email: 'admin@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'admin',
        isActive: true,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(admin);

      let thrown: any;
      try {
        await service.update('comp-1', 'admin-1', { isActive: false }, 'admin-1');
      } catch (e) {
        thrown = e;
      }
      console.log(`[self deactivate] ${thrown.constructor.name}: ${thrown.message}`);

      expect(thrown).toBeInstanceOf(ConflictException);
      expect(thrown.message).toContain('You cannot demote or deactivate your own admin account');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('(b) rejects demoting the ONLY other active admin of the company', async () => {
      const otherAdmin = {
        id: 'admin-2',
        email: 'admin2@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'admin',
        isActive: true,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(otherAdmin);
      // Aucun autre admin actif dans la société.
      mockPrisma.user.count.mockResolvedValueOnce(0);

      let thrown: any;
      try {
        await service.update('comp-1', 'admin-2', { role: 'dispatcher' }, 'admin-1');
      } catch (e) {
        thrown = e;
      }
      console.log(`[last admin demote] ${thrown.constructor.name}: ${thrown.message}`);

      expect(thrown).toBeInstanceOf(BadRequestException);
      expect(thrown.message).toContain('Cannot remove the last active admin of this company');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('(c) allows demoting one admin when another active admin remains', async () => {
      const targetAdmin = {
        id: 'admin-2',
        email: 'admin2@test.com',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'admin',
        isActive: true,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(targetAdmin);
      // Il reste 1 autre admin actif → rétrogradation autorisée.
      mockPrisma.user.count.mockResolvedValueOnce(1);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'admin-2',
        email: 'admin2@test.com',
        firstName: 'Admin',
        lastName: 'Two',
        phone: null,
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
      });

      const result = await service.update('comp-1', 'admin-2', { role: 'dispatcher' }, 'admin-1');

      console.log(
        `[demote with remaining admin] user.update appelé, count()=1 → role final=${result.role}`,
      );
      expect(mockPrisma.user.count).toHaveBeenCalledWith({
        where: {
          companyId: 'comp-1',
          role: 'admin',
          isActive: true,
          deletedAt: null,
          id: { not: 'admin-2' },
        },
      });
      expect(result.role).toBe('dispatcher');
    });
  });

  describe('updateProfile', () => {
    it('should update user profile', async () => {
      const dto: UpdateProfileDto = { firstName: 'New', lastName: 'Name', phone: '+1234567890' };
      const user = { id: 'user-1', firstName: 'Old', lastName: 'Name', phone: null };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'New',
        lastName: 'Name',
        phone: '+1234567890',
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
        avatarUrl: null,
      });

      const result = await service.updateProfile('user-1', dto);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { firstName: 'New', lastName: 'Name', phone: '+1234567890' },
        select: expect.any(Object),
      });
      expect(result.firstName).toBe('New');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.updateProfile('user-1', { firstName: 'Test' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateEmail', () => {
    it('should update email when valid', async () => {
      const user = { id: 'user-1', email: 'old@test.com', companyId: 'comp-1' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        email: 'new@test.com',
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
        avatarUrl: null,
      });

      const result = await service.updateEmail('user-1', 'new@test.com');

      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(1, {
        where: { id: 'user-1', deletedAt: null },
      });
      expect(mockPrisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: 'new@test.com' },
      });
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { email: 'new@test.com' },
        select: expect.any(Object),
      });
      expect(result.email).toBe('new@test.com');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.updateEmail('user-1', 'new@test.com')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw BadRequestException when new email equals current', async () => {
      const user = { id: 'user-1', email: 'same@test.com' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);

      await expect(service.updateEmail('user-1', 'same@test.com')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException when email already in use', async () => {
      const user = { id: 'user-1', email: 'old@test.com' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'other-user' });

      await expect(service.updateEmail('user-1', 'taken@test.com')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('changePassword', () => {
    const dto: ChangePasswordDto = {
      currentPassword: 'OldPass123!',
      newPassword: 'NewPass123!',
      confirmPassword: 'NewPass123!',
    };

    it('should change password and revoke sessions', async () => {
      const user = { id: 'user-1', passwordHash: 'hashed_old' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);
      (bcrypt.hash as jest.Mock).mockResolvedValueOnce('hashed_new');

      const result = await service.changePassword('user-1', dto);

      expect(bcrypt.compare).toHaveBeenCalledWith('OldPass123!', 'hashed_old');
      expect(bcrypt.hash).toHaveBeenCalledWith('NewPass123!', 12);
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed_new', refreshTokenHash: null },
      });
      expect(mockPrisma.userSession.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result.message).toContain('logged out from all devices');
    });

    it('should throw BadRequestException when passwords do not match', async () => {
      const mismatchedDto = { ...dto, confirmPassword: 'DifferentPass123!' };

      await expect(service.changePassword('user-1', mismatchedDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.changePassword('user-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when current password is incorrect', async () => {
      const user = { id: 'user-1', passwordHash: 'hashed_old' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      await expect(service.changePassword('user-1', dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateAvatar', () => {
    it('should update user avatar', async () => {
      const user = { id: 'user-1' };
      mockPrisma.user.findUnique.mockResolvedValueOnce(user);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@test.com',
        firstName: 'Test',
        lastName: 'User',
        phone: null,
        role: 'dispatcher',
        isActive: true,
        companyId: 'comp-1',
        createdAt: new Date(),
        avatarUrl: 'https://example.com/avatar.png',
      });

      const result = await service.updateAvatar('user-1', {
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { avatarUrl: 'https://example.com/avatar.png' },
        select: expect.any(Object),
      });
      expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(service.updateAvatar('user-1', { avatarUrl: 'url' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('should soft delete user', async () => {
      const user = { id: 'user-1', companyId: 'comp-1', deletedAt: null };
      mockPrisma.user.findFirst.mockResolvedValueOnce(user);
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'user-1',
        deletedAt: new Date(),
        isActive: false,
        refreshTokenHash: null,
      });

      const result = await service.remove('comp-1', 'user-1', 'current-user-id');

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { deletedAt: expect.any(Date), isActive: false, refreshTokenHash: null },
      });
      expect(result).toHaveProperty('deletedAt');
    });

    it('should throw ConflictException when trying to delete own account', async () => {
      await expect(service.remove('comp-1', 'user-1', 'user-1')).rejects.toThrow(ConflictException);
    });

    it('should throw NotFoundException when user not found', async () => {
      mockPrisma.user.findFirst.mockResolvedValueOnce(null);

      await expect(service.remove('comp-1', 'user-1', 'other-user')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should reject removing the last active admin of the company', async () => {
      const lastAdmin = {
        id: 'admin-1',
        companyId: 'comp-1',
        deletedAt: null,
        role: 'admin',
        isActive: true,
      };
      mockPrisma.user.findFirst.mockResolvedValueOnce(lastAdmin);
      mockPrisma.user.count.mockResolvedValueOnce(0);

      let thrown: any;
      try {
        await service.remove('comp-1', 'admin-1', 'other-admin');
      } catch (e) {
        thrown = e;
      }
      console.log(`[remove last admin] ${thrown.constructor.name}: ${thrown.message}`);

      expect(thrown).toBeInstanceOf(BadRequestException);
      expect(thrown.message).toContain('Cannot remove the last active admin of this company');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
  });
});
