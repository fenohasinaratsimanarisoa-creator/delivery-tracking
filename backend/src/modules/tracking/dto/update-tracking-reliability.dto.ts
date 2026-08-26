import { IsIn } from 'class-validator';
import { TrackingReliability } from '@prisma/client';

const TRACKING_RELIABILITY_VALUES: TrackingReliability[] = [
  'reliable',
  'battery_opt_not_ignored',
  'background_perm_missing',
  'oem_restricted',
];

export class UpdateTrackingReliabilityDto {
  @IsIn(TRACKING_RELIABILITY_VALUES)
  status: TrackingReliability;
}
