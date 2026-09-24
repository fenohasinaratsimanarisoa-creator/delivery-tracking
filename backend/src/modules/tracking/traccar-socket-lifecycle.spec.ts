import { EventEmitter } from 'events';
import { ConfigService } from '@nestjs/config';
import { TraccarBridgeService } from './traccar-bridge.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TrackingService } from './tracking.service';
import { TrackingGateway } from './tracking.gateway';
import { NotificationsService } from '../notifications/notifications.service';

// =============================================================================
// FUITE DE SOCKETS (audit trajets 2026-09-21) : 139 connexions WebSocket ouvertes vers
// Traccar après 3 jours — une de plus à chaque renouvellement de session (30 min), chaque
// position traitée ~139 fois. Cause : le 'close' tardif de l'ancien socket relançait un
// 2e connect() qui écrasait le socket courant sans le fermer.
// =============================================================================

const sockets: FakeSocket[] = [];
class FakeSocket extends EventEmitter {
  terminated = false;
  closed = false;
  constructor() {
    super();
    sockets.push(this);
  }
  close() {
    this.closed = true;
  }
  terminate() {
    this.terminated = true;
  }
}
jest.mock('ws', () => ({ WebSocket: jest.fn().mockImplementation(() => new FakeSocket()) }));

describe('TraccarBridgeService — un seul socket Traccar à la fois', () => {
  let service: any;
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.useFakeTimers();
    sockets.length = 0;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'JSESSIONID=abc; Path=/' },
    }) as any;
    const config = {
      get: jest.fn(
        (key: string, d?: string) =>
          ({ TRACCAR_URL: 'http://traccar:8082', TRACCAR_USER: 'u', TRACCAR_PASSWORD: 'p' })[key] ??
          d,
      ),
    };
    service = new TraccarBridgeService(
      config as unknown as ConfigService,
      {} as PrismaService,
      {} as TrackingService,
      {
        broadcastDataUpdate: jest.fn(),
        broadcastToCompany: jest.fn(),
      } as unknown as TrackingGateway,
      {} as NotificationsService,
      null,
      null,
    );
    service.performBackfill = jest.fn();
    service.handlePosition = jest.fn();
  });

  afterEach(() => {
    service.disconnect();
    jest.useRealTimers();
    global.fetch = realFetch;
  });

  const open = (s: FakeSocket) => s.emit('open');
  const live = () => sockets.filter((s) => !s.terminated && !s.closed);

  it('renouvellement de session puis close tardif de l’ancien socket : aucun socket en double', async () => {
    await service.connect();
    open(sockets[0]);

    // renouvellement (timer 30 min) : disconnect() + connect()
    service.disconnect();
    await service.connect();
    open(sockets[1]);

    // l'ancien socket émet son 'close' après coup (cas prod)
    sockets[0].emit('close', 1005);
    await jest.advanceTimersByTimeAsync(60_000);

    expect(sockets).toHaveLength(2);
    expect(live()).toEqual([sockets[1]]);
    expect(service.connected).toBe(true);
    expect(service.sessionCookie).toBe('JSESSIONID=abc');
  });

  it('48 renouvellements (une journée) : toujours un seul socket vivant', async () => {
    await service.connect();
    open(sockets[0]);
    for (let i = 0; i < 48; i++) {
      const previous = sockets[sockets.length - 1];
      service.disconnect();
      await service.connect();
      open(sockets[sockets.length - 1]);
      previous.emit('close', 1005);
      await jest.advanceTimersByTimeAsync(10_000);
    }
    expect(live()).toHaveLength(1);
  });

  it('un ancien socket ne traite plus les positions', async () => {
    await service.connect();
    open(sockets[0]);
    service.disconnect();
    await service.connect();
    open(sockets[1]);
    const msg = Buffer.from(JSON.stringify({ positions: [{ id: 1 }] }));
    sockets[0].emit('message', msg);
    sockets[1].emit('message', msg);
    await Promise.resolve();
    expect(service.handlePosition).toHaveBeenCalledTimes(1);
  });

  it('coupure réelle du socket courant : reconnexion automatique', async () => {
    await service.connect();
    open(sockets[0]);
    sockets[0].closed = true; // coupé côté serveur
    sockets[0].emit('close', 1006);
    expect(service.connected).toBe(false);
    await jest.advanceTimersByTimeAsync(120_000);
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    expect(live()).toHaveLength(1);
  });
});
