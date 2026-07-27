import { Injectable, Logger } from '@nestjs/common';
import { UnifiedGpsEvent } from '../interfaces/unified-gps-event';
import { TrackerDeviceService } from '../tracker-device.service';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
}

@Injectable()
export class TrackerSecurityService {
  private readonly logger = new Logger(TrackerSecurityService.name);

  private readonly rateLimitMap = new Map<string, { count: number; resetAt: number }>();

  constructor(private deviceService: TrackerDeviceService) {}

  async authenticate(imei: string): Promise<SecurityCheckResult> {
    if (!imei || imei.length < 10) {
      return { allowed: false, reason: 'IMEI invalide' };
    }

    const device = await this.deviceService.findByImei(imei);
    if (!device) {
      this.logger.warn(`Rejected unknown device: IMEI=${imei}`);
      return { allowed: false, reason: 'Appareil non enregistré — enregistrez l\'IMEI dans DelivTrack d\'abord' };
    }

    if (!device.isActive) {
      return { allowed: false, reason: 'Appareil désactivé' };
    }

    if (!device.vehicleId) {
      return { allowed: false, reason: 'Appareil non lié à un véhicule' };
    }

    return { allowed: true };
  }

  async checkRateLimit(imei: string): Promise<SecurityCheckResult> {
    const now = Date.now();
    const entry = this.rateLimitMap.get(imei);

    if (!entry || now > entry.resetAt) {
      this.rateLimitMap.set(imei, { count: 1, resetAt: now + 1000 });
      return { allowed: true };
    }

    entry.count++;
    if (entry.count > 10) {
      return { allowed: false, reason: 'Rate limit dépassé (max 10 positions/s)' };
    }

    return { allowed: true };
  }

  validateEvent(event: UnifiedGpsEvent): SecurityCheckResult {
    if (typeof event.latitude !== 'number' || isNaN(event.latitude)) {
      return { allowed: false, reason: 'Latitude invalide' };
    }
    if (typeof event.longitude !== 'number' || isNaN(event.longitude)) {
      return { allowed: false, reason: 'Longitude invalide' };
    }
    if (event.latitude < -90 || event.latitude > 90) {
      return { allowed: false, reason: `Latitude hors bornes: ${event.latitude}` };
    }
    if (event.longitude < -180 || event.longitude > 180) {
      return { allowed: false, reason: `Longitude hors bornes: ${event.longitude}` };
    }
    if (event.latitude === 0 && event.longitude === 0) {
      return { allowed: false, reason: 'Coordonnées nulles (0,0) rejetées' };
    }
    if (!event.timestamp || isNaN(event.timestamp.getTime())) {
      return { allowed: false, reason: 'Timestamp invalide' };
    }
    if (event.speed !== undefined && (event.speed < 0 || event.speed > 200)) {
      return { allowed: false, reason: `Vitesse invalide: ${event.speed} m/s` };
    }

    return { allowed: true };
  }
}
