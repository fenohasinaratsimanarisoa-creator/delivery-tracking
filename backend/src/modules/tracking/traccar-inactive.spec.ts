import { TraccarBridgeService } from './traccar-bridge.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AlertService } from '../../common/alerting/alert.service';

describe('TraccarBridgeService — notification inactive', () => {
  let mockConfig: any;
  let mockPrisma: any;
  let mockTrackingService: any;
  let mockGateway: any;
  let mockNotifications: jest.Mocked<NotificationsService>;
  let mockAlertService: jest.Mocked<AlertService>;
  let mockRedis: any;
  let bridges: TraccarBridgeService[] = [];

  function createBridge(url: string) {
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'TRACCAR_URL') return url;
      if (key === 'TRACCAR_USER') return 'admin';
      if (key === 'TRACCAR_PASSWORD') return 'admin';
      return null;
    });
    const bridge = new TraccarBridgeService(
      mockConfig as any,
      mockPrisma as any,
      mockTrackingService as any,
      mockGateway as any,
      mockNotifications as any,
      mockAlertService as any,
      mockRedis as any,
    );
    bridges.push(bridge);
    return bridge;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockConfig = { get: jest.fn() };
    mockPrisma = {};
    mockTrackingService = {};
    mockGateway = {};
    mockNotifications = { create: jest.fn().mockResolvedValue({}) } as any;
    mockAlertService = { send: jest.fn().mockResolvedValue(undefined) } as any;
    mockRedis = null;
    bridges = [];
  });

  afterEach(() => {
    for (const b of bridges) {
      b.onModuleDestroy();
    }
    jest.useRealTimers();
  });

  beforeAll(() => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('fetch mock'));
  });

  afterAll(() => {
    (global.fetch as jest.Mock).mockRestore();
  });

  it('envoie une notification admin au démarrage si TRACCAR_URL est la valeur par defaut', async () => {
    const bridge = createBridge('http://traccar:8082');
    await bridge.onModuleInit();
    expect(mockAlertService.send).toHaveBeenCalledTimes(1);
    expect(mockAlertService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warning',
        title: 'Pont Traccar non configuré',
      }),
    );
  });

  it('envoie une notification admin si TRACCAR_URL est disabled', async () => {
    const bridge = createBridge('disabled');
    await bridge.onModuleInit();
    expect(mockAlertService.send).toHaveBeenCalledTimes(1);
    expect(mockAlertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Pont Traccar non configuré' }),
    );
  });

  it('envoie la notification une seule fois meme si onModuleInit est appele deux fois', async () => {
    const bridge = createBridge('http://traccar:8082');
    await bridge.onModuleInit();
    await bridge.onModuleInit();
    expect(mockAlertService.send).toHaveBeenCalledTimes(1);
  });

  it('ne notifie pas si TRACCAR_URL est configure', async () => {
    const bridge = createBridge('http://mon-traccar-vps.com:8082');
    await bridge.onModuleInit();
    expect(mockAlertService.send).not.toHaveBeenCalled();
  });
});
