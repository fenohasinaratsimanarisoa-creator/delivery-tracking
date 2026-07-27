import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TrackerProtocol, UnifiedGpsEvent, DeviceCapability } from './interfaces/unified-gps-event';
import { GpsProtocolRegistry } from './registry/gps-protocol-registry';

interface DeviceInfo {
  id: string;
  imei: string;
  protocol: string;
  vehicleId: string | null;
  companyId: string;
  isActive: boolean;
  lastPositionAt: Date | null;
  modelName: string | null;
  capabilities: string[];
}

@Injectable()
export class TrackerDeviceService {
  private readonly logger = new Logger(TrackerDeviceService.name);

  constructor(
    private prisma: PrismaService,
    private registry: GpsProtocolRegistry,
  ) {}

  async findByImei(imei: string): Promise<DeviceInfo | null> {
    const device = await this.prisma.trackerDevice.findUnique({
      where: { imei },
      include: { deviceModel: true },
    });
    if (!device) return null;
    return this.toDeviceInfo(device);
  }

  async findByVehicleId(vehicleId: string, companyId: string): Promise<DeviceInfo | null> {
    const device = await this.prisma.trackerDevice.findFirst({
      where: { vehicleId, companyId },
      include: { deviceModel: true },
    });
    if (!device) return null;
    return this.toDeviceInfo(device);
  }

  async listByCompany(companyId: string): Promise<DeviceInfo[]> {
    const devices = await this.prisma.trackerDevice.findMany({
      where: { companyId },
      include: { deviceModel: true },
      orderBy: { createdAt: 'desc' },
    });
    return devices.map((d) => this.toDeviceInfo(d));
  }

  async register(
    companyId: string,
    imei: string,
    protocol: TrackerProtocol,
    deviceModelId?: string,
  ): Promise<DeviceInfo> {
    const existing = await this.prisma.trackerDevice.findUnique({ where: { imei } });
    if (existing) {
      throw new BadRequestException(`Device with IMEI ${imei} is already registered`);
    }

    const driver = this.registry.getDriver(protocol);
    if (!driver) {
      throw new BadRequestException(`Unsupported protocol: ${protocol}`);
    }

    const device = await this.prisma.trackerDevice.create({
      data: { imei, protocol, companyId, deviceModelId },
      include: { deviceModel: true },
    });

    this.logger.log(`Tracker device registered: IMEI=${imei} protocol=${protocol} company=${companyId}`);
    return this.toDeviceInfo(device);
  }

  async linkToVehicle(deviceId: string, vehicleId: string, companyId: string): Promise<DeviceInfo> {
    const device = await this.prisma.trackerDevice.findFirst({
      where: { id: deviceId, companyId },
    });
    if (!device) throw new NotFoundException('Tracker device not found');

    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, companyId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found in your company');

    const updated = await this.prisma.trackerDevice.update({
      where: { id: deviceId },
      data: {
        vehicleId,
        vehicle: { connect: { id: vehicleId } },
      } as any,
      include: { deviceModel: true },
    });

    await this.prisma.vehicle.update({
      where: { id: vehicleId },
      data: { positionSource: 'physical_tracker' },
    });

    this.logger.log(`Device ${device.imei} linked to vehicle ${vehicleId}`);
    return this.toDeviceInfo(updated);
  }

  async unlinkFromVehicle(deviceId: string, companyId: string): Promise<DeviceInfo> {
    const device = await this.prisma.trackerDevice.findFirst({
      where: { id: deviceId, companyId },
    });
    if (!device) throw new NotFoundException('Tracker device not found');

    const updated = await this.prisma.trackerDevice.update({
      where: { id: deviceId },
      data: { vehicleId: null } as any,
      include: { deviceModel: true },
    });

    return this.toDeviceInfo(updated);
  }

  async authenticateOrRegister(imei: string, protocol: TrackerProtocol): Promise<DeviceInfo | null> {
    let device = await this.findByImei(imei);
    if (device) return device.isActive ? device : null;
    return null;
  }

  async updateLastPosition(imei: string): Promise<void> {
    await this.prisma.trackerDevice.update({
      where: { imei },
      data: { lastPositionAt: new Date() },
    });
  }

  private toDeviceInfo(device: any): DeviceInfo {
    const driver = this.registry.getDriver(device.protocol as TrackerProtocol);
    const baseCaps = driver?.getCapabilities() ?? [];
    const modelCaps = (device.deviceModel?.capabilities as string[]) ?? [];
    const capabilities = [...new Set([...baseCaps, ...modelCaps])];

    return {
      id: device.id,
      imei: device.imei,
      protocol: device.protocol,
      vehicleId: device.vehicleId,
      companyId: device.companyId,
      isActive: device.isActive,
      lastPositionAt: device.lastPositionAt,
      modelName: device.deviceModel ? `${device.deviceModel.manufacturer} ${device.deviceModel.modelName}` : null,
      capabilities,
    };
  }

  async seedDeviceModels(): Promise<void> {
    const models: { manufacturer: string; modelName: string; protocol: TrackerProtocol; capabilities: DeviceCapability[] }[] = [
      { manufacturer: 'Concox', modelName: 'JM-VL03', protocol: TrackerProtocol.GT06, capabilities: ['gps', 'sos', 'battery', 'gsm_signal', 'satellites'] },
      { manufacturer: 'Concox', modelName: 'GT06N', protocol: TrackerProtocol.GT06, capabilities: ['gps', 'sos', 'battery', 'gsm_signal', 'satellites'] },
      { manufacturer: 'Concox', modelName: 'GT02', protocol: TrackerProtocol.GT06, capabilities: ['gps', 'sos', 'gsm_signal'] },
      { manufacturer: 'Teltonika', modelName: 'FMB001', protocol: TrackerProtocol.TELTONIKA, capabilities: ['gps', 'ignition', 'battery', 'temperature', 'mileage', 'engine_hours', 'gsm_signal', 'satellites'] },
      { manufacturer: 'Teltonika', modelName: 'FMB010', protocol: TrackerProtocol.TELTONIKA, capabilities: ['gps', 'ignition', 'battery', 'temperature', 'mileage', 'engine_hours', 'gsm_signal', 'satellites'] },
      { manufacturer: 'Teltonika', modelName: 'FMB020', protocol: TrackerProtocol.TELTONIKA, capabilities: ['gps', 'ignition', 'battery', 'temperature', 'mileage', 'engine_hours', 'gsm_signal', 'satellites', 'fuel'] },
      { manufacturer: 'Teltonika', modelName: 'FMB920', protocol: TrackerProtocol.TELTONIKA, capabilities: ['gps', 'ignition', 'battery', 'temperature', 'mileage', 'engine_hours', 'gsm_signal', 'satellites'] },
      { manufacturer: 'Teltonika', modelName: 'FMB962', protocol: TrackerProtocol.TELTONIKA, capabilities: ['gps', 'ignition', 'battery', 'temperature', 'mileage', 'engine_hours', 'gsm_signal', 'satellites', 'fuel', 'relay'] },
      { manufacturer: 'Coban', modelName: 'ST-901', protocol: TrackerProtocol.TK103, capabilities: ['gps', 'sos', 'gsm_signal'] },
      { manufacturer: 'Coban', modelName: 'ST-904', protocol: TrackerProtocol.TK103, capabilities: ['gps', 'sos', 'gsm_signal'] },
      { manufacturer: 'TK-Star', modelName: 'TK103', protocol: TrackerProtocol.TK103, capabilities: ['gps', 'sos', 'gsm_signal'] },
      { manufacturer: 'EELINK', modelName: 'H02', protocol: TrackerProtocol.H02, capabilities: ['gps', 'sos'] },
    ];

    for (const m of models) {
      const existing = await (this.prisma as any).deviceModel.findFirst({
        where: { manufacturer: m.manufacturer, modelName: m.modelName },
      });
      if (existing) {
        await (this.prisma as any).deviceModel.update({
          where: { id: existing.id },
          data: { capabilities: m.capabilities },
        });
      } else {
        await (this.prisma as any).deviceModel.create({
          data: { manufacturer: m.manufacturer, modelName: m.modelName, protocol: m.protocol, capabilities: m.capabilities },
        });
      }
    }

    this.logger.log(`Seeded ${models.length} device models`);
  }
}
