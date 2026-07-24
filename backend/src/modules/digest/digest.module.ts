import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DigestService } from './digest.service';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [ScheduleModule.forRoot(), EmailModule],
  providers: [DigestService],
})
export class DigestModule {}
