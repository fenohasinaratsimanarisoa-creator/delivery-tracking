import { UnifiedGpsEvent } from './unified-gps-event';
import { UpdatePositionDto } from '../../dto/update-position.dto';

export function unifiedEventToDto(event: UnifiedGpsEvent): Partial<UpdatePositionDto> {
  return {
    latitude: event.latitude,
    longitude: event.longitude,
    speed: event.speed,
    heading: event.heading,
    altitude: event.altitude,
    accuracy: event.accuracy,
    timestamp: event.timestamp.toISOString(),
  };
}
