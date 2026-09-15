import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';

@Injectable()
export class PaymentMethodsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.platformPaymentMethod.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async create(dto: CreatePaymentMethodDto) {
    return this.prisma.platformPaymentMethod.create({
      data: { ...dto, isActive: true, sortOrder: 0 },
    });
  }

  async update(id: string, dto: UpdatePaymentMethodDto) {
    const existing = await this.prisma.platformPaymentMethod.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Moyen de paiement introuvable');
    return this.prisma.platformPaymentMethod.update({ where: { id }, data: dto });
  }
}
