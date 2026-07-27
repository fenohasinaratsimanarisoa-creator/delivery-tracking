import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

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

    const lastEvent = await this.prisma.geofenceEvent.findFirst({
      where: { vehicleId, deliveryId },
      orderBy: { timestamp: 'desc' },
      select: { geofenceId: true, event: true },
    });

    const events: Array<{ event: string; geofenceId: string; geofenceName: string }> = [];

    for (const gf of geofences) {
      const distance = this.haversineDistance(latitude, longitude, gf.lat, gf.lng);
      const inside = distance <= gf.radiusMeters;

      const previouslyInside = lastEvent?.geofenceId === gf.id && lastEvent.event === 'entry';

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

  private haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
