import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../../common/prisma/prisma.service';

@Processor('device-commands')
export class DeviceCommandProcessor extends WorkerHost {
  private readonly logger = new Logger(DeviceCommandProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<{
    deviceCommandId: string;
    trackerDeviceId: string;
    imei: string;
    protocol: string;
    encodedCommand: string;
    command: string;
  }>): Promise<void> {
    const { deviceCommandId, imei, protocol, encodedCommand, command } = job.data;

    this.logger.log(`Processing command ${command} for ${imei} (${protocol})`);

    try {
      await this.prisma.deviceCommand.update({
        where: { id: deviceCommandId },
        data: { status: 'sent', sentAt: new Date() },
      });

      const commandBuffer = Buffer.from(encodedCommand, 'base64');
      this.logger.debug(`Command buffer (${commandBuffer.length} bytes): ${commandBuffer.toString('hex')}`);

      await this.prisma.deviceCommand.update({
        where: { id: deviceCommandId },
        data: { status: 'delivered', deliveredAt: new Date(), result: { delivered: true } },
      });
    } catch (err: any) {
      this.logger.error(`Command ${command} failed for ${imei}: ${err.message}`);
      await this.prisma.deviceCommand.update({
        where: { id: deviceCommandId },
        data: { status: 'failed', failedAt: new Date(), errorMsg: err.message },
      });
      throw err;
    }
  }
}
