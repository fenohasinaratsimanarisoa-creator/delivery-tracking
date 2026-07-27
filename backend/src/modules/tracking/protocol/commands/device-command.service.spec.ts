import { DeviceCommandService } from './device-command.service';
import { GpsProtocolRegistry } from '../registry/gps-protocol-registry';
import { TrackerProtocol } from '../interfaces/unified-gps-event';
import { Gt06Driver } from '../drivers/gt06.driver';

describe('DeviceCommandService', () => {
  let registry: GpsProtocolRegistry;
  let mockQueue: any;
  let mockPrisma: any;
  let service: DeviceCommandService;

  beforeEach(() => {
    registry = new GpsProtocolRegistry();
    registry.register(new Gt06Driver());

    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    mockPrisma = {
      trackerDevice: {
        findFirst: jest.fn(),
      },
      deviceCommand: {
        create: jest.fn().mockResolvedValue({ id: 'cmd-1', command: 'reboot', status: 'pending' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    service = new DeviceCommandService(mockQueue as any, mockPrisma, registry);
  });

  it('returns unsupported for commands not in the protocol list', async () => {
    mockPrisma.trackerDevice.findFirst.mockResolvedValue({
      id: 'dev-1', imei: '123456789012345', protocol: TrackerProtocol.GT06, companyId: 'c-1',
    });

    const result = await service.sendCommand('c-1', 'dev-1', 'cut_engine' as any);
    expect(result.status).toBe('unsupported');
  });

  it('queues a supported command via BullMQ', async () => {
    mockPrisma.trackerDevice.findFirst.mockResolvedValue({
      id: 'dev-1', imei: '123456789012345', protocol: TrackerProtocol.GT06, companyId: 'c-1',
    });

    const result = await service.sendCommand('c-1', 'dev-1', 'reboot');
    expect(result.status).toBe('pending');
    expect(mockQueue.add).toHaveBeenCalledWith('send', expect.objectContaining({
      command: 'reboot',
      imei: '123456789012345',
    }));
  });

  it('throws NotFoundException for unknown device', async () => {
    mockPrisma.trackerDevice.findFirst.mockResolvedValue(null);
    await expect(service.sendCommand('c-1', 'unknown-device', 'reboot')).rejects.toThrow();
  });

  it('returns command history', async () => {
    mockPrisma.trackerDevice.findFirst.mockResolvedValue({ id: 'dev-1', companyId: 'c-1' });
    mockPrisma.deviceCommand.findMany.mockResolvedValue([{ id: 'c1', command: 'reboot', status: 'delivered' }]);

    const history = await service.getCommandHistory('dev-1', 'c-1');
    expect(history).toHaveLength(1);
  });
});
