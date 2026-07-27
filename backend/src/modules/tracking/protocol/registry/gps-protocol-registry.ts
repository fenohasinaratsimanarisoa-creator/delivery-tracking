import { Injectable } from '@nestjs/common';
import { GpsProtocolDriver } from '../interfaces/gps-protocol-driver';
import { TrackerProtocol } from '../interfaces/unified-gps-event';

@Injectable()
export class GpsProtocolRegistry {
  private drivers: Map<TrackerProtocol, GpsProtocolDriver> = new Map();

  register(driver: GpsProtocolDriver): void {
    this.drivers.set(driver.protocolName, driver);
  }

  unregister(protocol: TrackerProtocol): void {
    this.drivers.delete(protocol);
  }

  getDriver(protocol: TrackerProtocol): GpsProtocolDriver | undefined {
    return this.drivers.get(protocol);
  }

  detectDriver(rawPacket: Buffer): GpsProtocolDriver | undefined {
    for (const driver of this.drivers.values()) {
      if (driver.canHandle(rawPacket)) {
        return driver;
      }
    }
    return undefined;
  }

  getAllDrivers(): GpsProtocolDriver[] {
    return Array.from(this.drivers.values());
  }

  getSupportedProtocols(): TrackerProtocol[] {
    return Array.from(this.drivers.keys());
  }
}
