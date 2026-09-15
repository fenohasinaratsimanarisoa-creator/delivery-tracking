import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PaymentProofsController } from './payment-proofs.controller';
import { PaymentProofsService } from './payment-proofs.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { TotpService } from '../auth/totp.service';
import { TrackingModule } from '../tracking/tracking.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>(
            'JWT_ACCESS_EXPIRATION',
            '15m',
          ) as jwt.SignOptions['expiresIn'],
        },
      }),
    }),
    TrackingModule,
    EmailModule,
  ],
  controllers: [PlatformAdminController, PaymentProofsController, PaymentMethodsController],
  providers: [PlatformAdminService, TotpService, PaymentProofsService, PaymentMethodsService],
  exports: [PlatformAdminService],
})
export class PlatformAdminModule {}
