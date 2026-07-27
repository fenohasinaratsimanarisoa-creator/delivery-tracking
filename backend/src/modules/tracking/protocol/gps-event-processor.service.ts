import { Injectable, Logger } from '@nestjs/common';
import { UnifiedGpsEvent } from './interfaces/unified-gps-event';
import { unifiedEventToDto } from './interfaces/gps-event-adapter';
import { TrackingService } from '../tracking.service';

@Injectable()
export class GpsEventProcessorService {
  private readonly logger = new Logger(GpsEventProcessorService.name);

  constructor(private trackingService: TrackingService) {}

  async process(event: UnifiedGpsEvent): Promise<void> {
    try {
      const dto = unifiedEventToDto(event);
      if (typeof dto.latitude !== 'number' || typeof dto.longitude !== 'number') {
        this.logger.warn(`Invalid coordinates from device ${event.imei}: lat=${event.latitude}, lng=${event.longitude}`);
        return;
      }

      this.logger.log(`Processing position: IMEI=${event.imei} (${event.latitude.toFixed(4)}, ${event.longitude.toFixed(4)}) proto=${event.protocol}`);
    } catch (err: any) {
      this.logger.error(`GpsEventProcessor error: ${err.message}`);
    }
  }
}
