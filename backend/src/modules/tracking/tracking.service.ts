import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { UpdatePositionDto } from './dto/update-position.dto';

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(private prisma: PrismaService) {}

  async findDriverByUserId(userId: string) {
    return this.prisma.driver.findUnique({ where: { userId } });
  }

  async savePosition(driverId: string, dto: UpdatePositionDto) {
    const dup = await this.prisma.gpsPosition.findFirst({
      where: {
        driverId,
        deliveryId: dto.deliveryId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timestamp: new Date(dto.timestamp),
      },
    });
    if (dup) return dup;

    const locationStr = `POINT(${dto.longitude} ${dto.latitude})`;

    return this.prisma.gpsPosition.create({
      data: {
        latitude: dto.latitude,
        longitude: dto.longitude,
        speed: dto.speed,
        location: locationStr,
        timestamp: new Date(dto.timestamp),
        deliveryId: dto.deliveryId,
        vehicleId: dto.vehicleId,
        driverId,
      },
    });
  }

  async saveBatch(driverId: string, positions: UpdatePositionDto[]) {
    const saved: any[] = [];
    for (const pos of positions) {
      const result = await this.savePosition(driverId, pos);
      saved.push(result);
    }
    return saved;
  }

  async getPositionsByDelivery(deliveryId: string, companyId: string) {
    return this.prisma.gpsPosition.findMany({
      where: {
        deliveryId,
        delivery: { companyId },
      },
      orderBy: { timestamp: 'asc' },
    });
  }

  async getDeliveryInfo(deliveryId: string, companyId: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, companyId },
      select: {
        id: true,
        title: true,
        status: true,
        pickupAddress: true,
        deliveryAddress: true,
        pickupLat: true,
        pickupLng: true,
        deliveryLat: true,
        deliveryLng: true,
      },
    });
    if (!delivery) throw new Error('Delivery not found');
    return delivery;
  }

  async calculateDistance(deliveryId: string, companyId: string): Promise<{ meters: number; kilometers: number }> {
    const positions = await this.getPositionsByDelivery(deliveryId, companyId);
    if (positions.length < 2) return { meters: 0, kilometers: 0 };

    let totalDistance = 0;
    for (let i = 1; i < positions.length; i++) {
      totalDistance += this.haversineDistance(
        positions[i - 1].latitude,
        positions[i - 1].longitude,
        positions[i].latitude,
        positions[i].longitude,
      );
    }
    return {
      meters: Math.round(totalDistance),
      kilometers: Math.round(totalDistance / 10) / 100,
    };
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
