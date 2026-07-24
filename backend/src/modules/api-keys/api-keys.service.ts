import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import * as crypto from 'crypto';

function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const key = `dt_${raw}`;
  const prefix = key.substring(0, 14);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return { key, prefix, hash };
}

@Injectable()
export class ApiKeysService {
  constructor(private prisma: PrismaService) {}

  async create(companyId: string, dto: CreateApiKeyDto) {
    const { key, prefix, hash } = generateApiKey();

    await this.prisma.apiKey.create({
      data: {
        companyId,
        name: dto.name,
        keyHash: hash,
        prefix,
        scopes: dto.scopes,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });

    return { key, prefix, name: dto.name, scopes: dto.scopes };
  }

  async findAll(companyId: string) {
    return this.prisma.apiKey.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        expiresAt: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(companyId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, companyId },
    });
    if (!key) throw new NotFoundException('API key not found');

    await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
