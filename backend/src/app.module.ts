import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { VehiclesModule } from './modules/vehicles/vehicles.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { FuelConsumptionModule } from './modules/fuel-consumption/fuel-consumption.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    VehiclesModule,
    DriversModule,
    DeliveriesModule,
    TrackingModule,
    FuelConsumptionModule,
    NotificationsModule,
  ],
})
export class AppModule {}
