import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

function mockResponse(body: unknown, init: { status?: number; setCookie?: string | null }) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'set-cookie' ? (init.setCookie ?? null) : null,
    },
    json: async () => body,
  };
}

function createService(url: string, user: string, password: string) {
  const config = {
    get: jest.fn((key: string, d?: string) => {
      const m: Record<string, string> = {
        TRACCAR_URL: url,
        TRACCAR_USER: user,
        TRACCAR_PASSWORD: password,
      };
      return m[key] ?? (d as any);
    }),
  };
  return new TraccarBridgeService(
    config as unknown as ConfigService,
    {} as unknown as PrismaService,
    {} as unknown as TrackingService,
    {} as unknown as TrackingGateway,
    {} as unknown as NotificationsService,
    null,
    null,
  );
}

describe('TraccarBridgeService — diagnosePlatformConfig (Traccar Cloud réel mocké)', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('(1) authentification réussie HTTP 200 + liste des devices avec protocole GT06 inféré depuis la position', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/session')) {
        return Promise.resolve(
          mockResponse(null, { status: 200, setCookie: 'JSESSIONID=diag-abc123; Path=/' }),
        );
      }
      if (url.endsWith('/api/devices')) {
        return Promise.resolve(
          mockResponse(
            [
              {
                id: 1,
                name: 'Test GT06',
                uniqueId: '123456789012345',
                status: 'online',
                disabled: false,
                lastUpdate: '2026-08-06T10:00:00Z',
                attributes: {},
              },
              {
                id: 2,
                name: 'Fleet Teltonika',
                uniqueId: '123456789012346',
                status: 'offline',
                disabled: false,
                lastUpdate: '2026-07-30T08:00:00Z',
                attributes: { protocol: 'teltonika' },
              },
            ],
            { status: 200 },
          ),
        );
      }
      if (url.endsWith('/api/positions')) {
        return Promise.resolve(
          mockResponse(
            [
              { id: 101, deviceId: 1, protocol: 'gt06', latitude: -18.87, longitude: 47.52 },
              { id: 102, deviceId: 2, protocol: 'teltonika', latitude: -18.88, longitude: 47.53 },
            ],
            { status: 200 },
          ),
        );
      }
      return Promise.resolve(mockResponse(null, { status: 404 }));
    });

    const service = createService(
      'https://server.traccar.org',
      'admin-delivtrack@example.com',
      'mot-de-passe-reel',
    );
    const report = await service.diagnosePlatformConfig();

    process.stdout.write(
      '[CAPTURE] Rapport diagnosePlatformConfig (cas succès):\n' +
        JSON.stringify(report, null, 2) +
        '\n\n',
    );

    expect(report.config.fullyConfigured).toBe(true);
    expect(report.authentication).toEqual({
      attempted: true,
      success: true,
      httpStatus: 200,
      error: null,
    });
    expect(report.devices.success).toBe(true);
    expect(report.devices.httpStatus).toBe(200);
    expect(report.devices.count).toBe(2);
    expect(report.devices.protocolInferenceAvailable).toBe(true);
    expect(report.devices.items[0]).toEqual(
      expect.objectContaining({
        id: 1,
        uniqueId: '123456789012345',
        status: 'online',
        protocol: 'gt06',
        protocolSource: 'position_traccar',
      }),
    );
    expect(report.devices.items[1].protocol).toBe('teltonika');
    expect(report.protocolPort.exposedByApi).toBe(false);
    expect(report.protocolPort.message).toContain("port d'écoute par protocole");
    expect(report.protocolPort.message).toContain("à confirmer manuellement dans l'interface");
  });

  it("(2) échec d'authentification HTTP 401 — code exact rapporté, devices non tentés", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/session')) {
        return Promise.resolve(mockResponse(null, { status: 401 }));
      }
      return Promise.resolve(mockResponse(null, { status: 500 }));
    });

    const service = createService(
      'https://server.traccar.org',
      'admin-delivtrack@example.com',
      'mauvais-mot-de-passe',
    );
    const report = await service.diagnosePlatformConfig();

    process.stdout.write(
      '[CAPTURE] Rapport diagnosePlatformConfig (cas échec 401):\n' +
        JSON.stringify(report, null, 2) +
        '\n\n',
    );

    expect(report.authentication.attempted).toBe(true);
    expect(report.authentication.success).toBe(false);
    expect(report.authentication.httpStatus).toBe(401);
    expect(report.authentication.error).toContain('HTTP 401');
    expect(report.devices.success).toBe(false);
    expect(report.devices.count).toBe(0);
    expect(report.devices.error).toContain('Session impossible');
    expect(report.protocolPort.exposedByApi).toBe(false);
  });

  it('(3) credentials par défaut — aucune authentification tentée, aucun appel réseau', async () => {
    const service = createService('http://traccar:8082', 'admin', 'admin');
    const report = await service.diagnosePlatformConfig();

    expect(report.config.fullyConfigured).toBe(false);
    expect(report.authentication.attempted).toBe(false);
    expect(report.authentication.success).toBeNull();
    expect(report.devices.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(4) cookie de session absent après un 200 — échec rapporté sans status HTTP inventé', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/api/session')) {
        return Promise.resolve(mockResponse(null, { status: 200, setCookie: null }));
      }
      return Promise.resolve(mockResponse(null, { status: 500 }));
    });

    const service = createService(
      'https://server.traccar.org',
      'admin-delivtrack@example.com',
      'mot-de-passe-reel',
    );
    const report = await service.diagnosePlatformConfig();

    expect(report.authentication.success).toBe(false);
    expect(report.authentication.httpStatus).toBe(200);
    expect(report.authentication.error).toBe('Traccar did not return a session cookie');
    expect(report.devices.success).toBe(false);
  });
});
