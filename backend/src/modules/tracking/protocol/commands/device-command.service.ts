import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { GpsProtocolRegistry } from '../registry/gps-protocol-registry';
import { TrackerProtocol, DeviceCommandType } from '../interfaces/unified-gps-event';

@Injectable()
export class DeviceCommandService {
  private readonly logger = new Logger(DeviceCommandService.name);

  private readonly SUPPORTED_COMMANDS: Record<string, DeviceCommandType[]> = {
    [TrackerProtocol.GT06]: ['reboot', 'set_interval', 'set_apn', 'fetch_config'],
    [TrackerProtocol.TELTONIKA]: [],
    [TrackerProtocol.TK103]: [],
    [TrackerProtocol.H02]: [],
  };

  constructor(
    @InjectQueue('device-commands') private commandQueue: Queue,
    private prisma: PrismaService,
    private registry: GpsProtocolRegistry,
  ) {}

  async sendCommand(
    companyId: string,
    trackerDeviceId: string,
    command: DeviceCommandType,
    parameters?: Record<string, unknown>,
  ): Promise<{ id: string; command: string; status: string }> {
    const device = await this.prisma.trackerDevice.findFirst({
      where: { id: trackerDeviceId, companyId },
    });
    if (!device) throw new NotFoundException('Tracker device not found');

    const driver = this.registry.getDriver(device.protocol as TrackerProtocol);
    if (!driver) throw new NotFoundException(`No driver for protocol ${device.protocol}`);

    const supported = this.SUPPORTED_COMMANDS[device.protocol] || [];
    if (!supported.includes(command)) {
      return {
        id: trackerDeviceId,
        command,
        status: 'unsupported',
      };
    }

    const encoded = driver.encodeCommand({ command, parameters });
    if (!encoded) {
      return {
        id: trackerDeviceId,
        command,
        status: 'unsupported',
      };
    }

    const record = await this.prisma.deviceCommand.create({
      data: {
        trackerId: trackerDeviceId,
        command,
        parameters: parameters as any,
        status: 'pending',
      },
    });

    await this.commandQueue.add('send', {
      deviceCommandId: record.id,
      trackerDeviceId,
      imei: device.imei,
      protocol: device.protocol,
      encodedCommand: encoded.toString('base64'),
      command,
    });

    this.logger.log(`Command queued: ${command} → ${device.imei} (${device.protocol})`);
    return { id: record.id, command, status: 'pending' };
  }

  async getCommandHistory(trackerDeviceId: string, companyId: string): Promise<any[]> {
    const device = await this.prisma.trackerDevice.findFirst({
      where: { id: trackerDeviceId, companyId },
    });
    if (!device) throw new NotFoundException('Tracker device not found');

    return this.prisma.deviceCommand.findMany({
      where: { trackerId: trackerDeviceId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }
}
