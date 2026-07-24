import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UsageGuard } from '../../common/guards/usage.guard';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsageGuard],
  exports: [UsersService],
})
export class UsersModule {}
