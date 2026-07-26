import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WsJwtGuard } from '../../common/guards/ws-jwt.guard';
import { WsAuthService } from '../../common/auth/ws-auth.service';
import { TrackingGateway } from './tracking.gateway';
import { TrackingService } from './tracking.service';
import { GeofenceService } from './geofence.service';
import { TraccarBridgeService } from './traccar-bridge.service';
import { TrackingController } from './tracking.controller';
import { GeofenceController } from './geofence.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApiKeyOrJwtGuard } from '../api-keys/guards/api-key-or-jwt.guard';
import { CacheModule } from '../../common/cache/cache.module';
import { RedisModule } from '../../common/redis/redis.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_ACCESS_SECRET'),
        signOptions: { expiresIn: configService.get<string>('JWT_ACCESS_EXPIRATION', '15m') },
      }),
    }),
    NotificationsModule,
    CacheModule,
    RedisModule,
  ],
  controllers: [TrackingController, GeofenceController],
  providers: [
    TrackingGateway,
    TrackingService,
    GeofenceService,
    TraccarBridgeService,
    WsJwtGuard,
    WsAuthService,
    ApiKeyOrJwtGuard,
  ],
  exports: [TrackingService, GeofenceService, TraccarBridgeService],
})
export class TrackingModule {}
