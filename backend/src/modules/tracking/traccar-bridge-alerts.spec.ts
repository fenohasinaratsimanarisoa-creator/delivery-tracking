import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { Logger } from '@nestjs/common';
import { AlertService } from '../../common/alerting/alert.service';

const mockRedis = { call: jest.fn(), expire: jest.fn(), get: jest.fn(), del: jest.fn(), set: jest.fn() };
const mockPrisma = {
  vehicle: { findMany: jest.fn(), findFirst: jest.fn() },
  delivery: { findFirst: jest.fn() },
  gpsPosition: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
};
const mockTrackingService = {
  savePosition: jest.fn(), getLastPosition: jest.fn(), getCompanySettings: jest.fn(),
};
const mockGateway = { broadcastDataUpdate: jest.fn(), broadcastToCompany: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockAlertService = { send: jest.fn() };

function createService(alertService: AlertService | null, traccarUrl = 'http://traccar-prod:8082') {
  const config = { get: jest.fn((key: string, d?: string) => {
    const m: Record<string, string> = { TRACCAR_URL: traccarUrl, TRACCAR_USER: 'test', TRACCAR_PASSWORD: 'test' };
    return m[key] ?? (d as any);
  })};
  return new TraccarBridgeService(
    config as unknown as ConfigService,
    mockPrisma as unknown as PrismaService,
    mockTrackingService as unknown as TrackingService,
    mockGateway as unknown as TrackingGateway,
    mockNotifications as unknown as NotificationsService,
    alertService,
    mockRedis as any,
  );
}

describe('TraccarBridgeService — Platform Alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should send platform alert via AlertService on inactive Traccar', async () => {
    mockRedis.call.mockResolvedValue(null);
    mockAlertService.send.mockResolvedValue(undefined);

    const service = createService(mockAlertService as unknown as AlertService, 'http://traccar:8082');
    await service.onModuleInit();

    expect(mockAlertService.send).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'warning', title: 'Pont Traccar non configuré' }),
    );
    expect(mockNotifications.create).not.toHaveBeenCalled();
  });

  it('should NOT use NotificationsService for platform alerts (no sentinel companyId)', async () => {
    mockRedis.call.mockResolvedValue(null);
    mockAlertService.send.mockResolvedValue(undefined);

    const service = createService(mockAlertService as unknown as AlertService, 'http://traccar:8082');
    await service.onModuleInit();

    expect(mockNotifications.create).not.toHaveBeenCalled();
  });

  it('should fall back to logger.warn when AlertService is not available', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    const service = createService(null, 'http://traccar:8082');
    await service.onModuleInit();

    expect(mockAlertService.send).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
