import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DigestService } from './digest.service';
import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ScheduleModule.forRoot(), EmailModule, NotificationsModule],
  providers: [DigestService],
})
export class DigestModule {}
