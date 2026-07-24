import { Module, Global } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { PrismaEncryptionMiddleware } from './prisma-encryption.middleware';

@Global()
@Module({
  providers: [EncryptionService, PrismaEncryptionMiddleware],
  exports: [EncryptionService],
})
export class EncryptionModule {}
