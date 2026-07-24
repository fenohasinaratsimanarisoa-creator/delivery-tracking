import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { API_KEY_SCOPE_KEY } from '../decorators/api-key-scope.decorator';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyOrJwtGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string;

    if (apiKey) {
      return this.validateApiKey(request, apiKey, context);
    }

    if (request.user) {
      return true;
    }

    throw new UnauthorizedException(
      'Authentication required. Provide JWT Bearer token or X-API-Key header.',
    );
  }

  private async validateApiKey(
    request: any,
    apiKey: string,
    context: ExecutionContext,
  ): Promise<boolean> {
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const keyRecord = await this.prisma.apiKey.findFirst({
      where: { keyHash: hash, isActive: true },
      include: { company: { select: { id: true, name: true } } },
    });

    if (!keyRecord) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    const scopes = keyRecord.scopes as string[];
    const requiredScope = this.reflector.getAllAndOverride<string>(API_KEY_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (requiredScope && !scopes.includes(requiredScope)) {
      throw new UnauthorizedException(`API key missing required scope: ${requiredScope}`);
    }

    await this.prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    });

    request.apiKey = {
      companyId: keyRecord.companyId,
      company: keyRecord.company,
      scopes,
      keyId: keyRecord.id,
    };
    request.user = { companyId: keyRecord.companyId, type: 'api_key' };

    return true;
  }
}
