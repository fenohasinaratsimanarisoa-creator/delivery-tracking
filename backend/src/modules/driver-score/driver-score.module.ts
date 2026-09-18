import { Module } from '@nestjs/common';
import { DriverScoreController } from './driver-score.controller';
import { DriverScoreService } from './driver-score.service';

@Module({
  controllers: [DriverScoreController],
  providers: [DriverScoreService],
  exports: [DriverScoreService],
})
export class DriverScoreModule {}
