import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        companyId,
      },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, isActive: true, companyId: true, createdAt: true,
      },
    });
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
          id: true, email: true, firstName: true, lastName: true,
          phone: true, role: true, isActive: true, companyId: true, createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findById(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, isActive: true, companyId: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByCompany(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, deletedAt: null },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, isActive: true, companyId: true,
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

    const data: any = { ...dto };
    if (dto.password) {
      data.passwordHash = await bcrypt.hash(dto.password, 10);
      delete data.password;
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true, email: true, firstName: true, lastName: true,
        phone: true, role: true, isActive: true, companyId: true, createdAt: true,
      },
    });
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
      data: { deletedAt: new Date(), isActive: false },
    });
  }
}
