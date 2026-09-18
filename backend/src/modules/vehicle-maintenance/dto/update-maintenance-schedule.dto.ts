import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsBoolean } from 'class-validator';
import { CreateMaintenanceScheduleDto } from './create-maintenance-schedule.dto';

export class UpdateMaintenanceScheduleDto extends PartialType(CreateMaintenanceScheduleDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
