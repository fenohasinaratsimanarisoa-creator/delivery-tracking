import { Injectable, Logger } from '@nestjs/common';
import { GpsProtocolRegistry } from '../registry/gps-protocol-registry';
import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';

@Injectable()
export class ProtocolDetectionLayer {
  private readonly logger = new Logger(ProtocolDetectionLayer.name);

  constructor(private registry: GpsProtocolRegistry) {}

  detect(rawPacket: Buffer): GpsProtocolDriver | undefined {
    const driver = this.registry.detectDriver(rawPacket);
    if (!driver) {
      this.logger.debug(`No driver found for packet: ${rawPacket.toString('hex').slice(0, 40)}...`);
    }
    return driver;
  }

  detectByImei(imei: string): GpsProtocolDriver | undefined {
    for (const driver of this.registry.getAllDrivers()) {
      try {
        const testImei = driver.extractImei(Buffer.from(imei));
        if (testImei) return driver;
      } catch {}
    }
    return undefined;
  }
}
