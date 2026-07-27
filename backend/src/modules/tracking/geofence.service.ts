import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { haversineDistance } from '../../common/geo/geo.utils';

@Injectable()
export class GeofenceService {
  private readonly logger = new Logger(GeofenceService.name);

  constructor(private prisma: PrismaService) {}

  async findForDelivery(deliveryId: string) {
    return this.prisma.geofence.findMany({ where: { deliveryId } });
  }

  async checkGeofences(
    deliveryId: string,
    vehicleId: string,
    latitude: number,
    longitude: number,
  ): Promise<Array<{ event: string; geofenceId: string; geofenceName: string }>> {
    const geofences = await this.findForDelivery(deliveryId);
    if (geofences.length === 0) return [];

    const allEvents = await this.prisma.geofenceEvent.findMany({
      where: { vehicleId, deliveryId },
      orderBy: { timestamp: 'desc' },
      select: { geofenceId: true, event: true },
    });

    const lastEventPerGeofence = new Map<string, string>();
    for (const ev of allEvents) {
      if (!lastEventPerGeofence.has(ev.geofenceId)) {
        lastEventPerGeofence.set(ev.geofenceId, ev.event);
      }
    }

    const events: Array<{ event: string; geofenceId: string; geofenceName: string }> = [];

    for (const gf of geofences) {
      const distance = haversineDistance(latitude, longitude, gf.lat, gf.lng);
      const inside = distance <= gf.radiusMeters;

      const previouslyInside = lastEventPerGeofence.get(gf.id) === 'entry';

      if (inside && !previouslyInside) {
        await this.prisma.geofenceEvent.create({
          data: { geofenceId: gf.id, vehicleId, deliveryId, event: 'entry', latitude, longitude },
        });
        events.push({ event: 'entry', geofenceId: gf.id, geofenceName: gf.name });
      }

      if (!inside && previouslyInside) {
        await this.prisma.geofenceEvent.create({
          data: { geofenceId: gf.id, vehicleId, deliveryId, event: 'exit', latitude, longitude },
        });
        events.push({ event: 'exit', geofenceId: gf.id, geofenceName: gf.name });
      }
    }

    return events;
  }

}
