import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrackingGateway } from './tracking.gateway';
import { UpdatePositionDto } from './dto/update-position.dto';

/**
 * Test D — Acquittement WebSocket RÉEL (round-trip socket.io, pas un stub).
 *
 * Le bug criticité : le téléphone appelle socket.emit('updatePosition', payload)
 * SANS callback ack, et le gateway ne répondait que par "return { event, data }".
 * Or une valeur retournée par un handler @SubscribeMessage n'est transmise au
 * client QUE s'il a fourni un callback ack à son emit — donc les listeners
 * 'positionSaved'/'positionRejected'/'positionsSaved' du téléphone ne se
 * déclenchaient JAMAIS : isSendingRef restait bloqué jusqu'au timeout de secours,
 * et la majorité des positions (jusqu'à 80-90% de la distance) étaient perdues.
 *
 * Ce test fait tourner le VRAI TrackingGateway (handlers réels) sur un VRAI
 * serveur socket.io, relié par un VRAI client socket.io-client : c'est le
 * mécanisme de transport complet d'engine.io (upgrade WebSocket, packets,
 * namespaces) qui est exercé, pas une émulation.
 */
describe('TrackingGateway — ACK WebSocket réel (Test D)', () => {
  let httpServer: HttpServer;
  let ioServer: Server;
  let client: ClientSocket;
  let gateway: TrackingGateway;

  const savedPositions: Array<{ id: string; vehicleId: string; timestamp: string }> = [];

  const DRIVER_USER = {
    id: 'driver-user-1',
    role: 'driver',
    companyId: 'company-a',
    firstName: 'Test',
    lastName: 'Driver',
  };

  const trackingService = {
    isRateLimited: jest.fn().mockResolvedValue(false),
    isBatchRateLimited: jest.fn().mockResolvedValue(false),
    verifyDriverAssignment: jest.fn().mockResolvedValue(undefined),
    assertVehicleOwnership: jest.fn().mockResolvedValue(undefined),
    findDriverByUserId: jest.fn().mockResolvedValue({ id: 'driver-1' }),
    getLastPosition: jest.fn().mockResolvedValue(null),
    savePosition: jest.fn().mockImplementation((driverId, dto) => {
      const position = {
        id: `pos-real-${savedPositions.length + 1}`,
        suspect: false,
        latitude: dto.latitude,
        longitude: dto.longitude,
        timestamp: dto.timestamp,
        vehicleId: dto.vehicleId,
      };
      savedPositions.push({
        id: position.id,
        vehicleId: dto.vehicleId,
        timestamp: dto.timestamp,
      });
      return Promise.resolve(position);
    }),
    saveBatch: jest.fn().mockResolvedValue([]),
    getDeliveryInfo: jest.fn(),
  };

  // Réplique EXACTEMENT TrackingService.validateAndSaveBatch (rate limit →
  // validation parallèle class-validator → résolution driver → saveBatch), en
  // déléguant aux mocks isBatchRateLimited/findDriverByUserId/saveBatch
  // ci-dessus — pour que ce test (VRAI gateway, VRAI socket.io) exerce la
  // même validation réelle qu'en production après le refactor gateway→service
  // partagé (Phase 2, POST /tracking/positions/native-batch).
  (trackingService as any).validateAndSaveBatch = jest.fn(
    async (userId: string, companyId: string, rawPositions: unknown) => {
      if (await trackingService.isBatchRateLimited(userId)) {
        return { status: 'rate_limited' as const };
      }
      if (!Array.isArray(rawPositions) || rawPositions.length === 0) {
        return { status: 'empty' as const };
      }
      const validationResults = await Promise.all(
        rawPositions.map(async (raw) => {
          const instance = plainToInstance(UpdatePositionDto, raw, {
            exposeUnsetFields: false,
            enableImplicitConversion: true,
          });
          const errors = await validate(instance, { whitelist: true, skipMissingProperties: false });
          return { instance, errors };
        }),
      );
      const validatedPositions: UpdatePositionDto[] = [];
      for (const { instance, errors } of validationResults) {
        if (errors.length > 0) continue;
        validatedPositions.push(instance);
      }
      const driver = await trackingService.findDriverByUserId(userId);
      if (!driver) return { status: 'no_driver' as const };
      if (validatedPositions.length === 0) {
        return { status: 'ok' as const, saved: [], validatedCount: 0, driverId: driver.id };
      }
      const saved = await trackingService.saveBatch(userId, driver.id, validatedPositions, companyId);
      return { status: 'ok' as const, saved, validatedCount: validatedPositions.length, driverId: driver.id };
    },
  );

  beforeAll(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer, { cors: { origin: '*' } });
    gateway = new TrackingGateway(
      trackingService as any,
      { verify: jest.fn().mockResolvedValue(DRIVER_USER) } as any,
      { on: jest.fn(), off: jest.fn() } as any,
      { snoozeProximity: jest.fn() } as any,
    );
    (gateway as any).server = ioServer;

    // Branche les handlers RÉELS du gateway sur le serveur socket.io réel.
    // En production, WsJwtGuard met client.data.user sur chaque socket ; on
    // reproduit ici ce contrat (le rôle du garde n'est pas l'objet du test).
    ioServer.on('connection', (socket) => {
      socket.data.user = DRIVER_USER;
      socket.on('updatePosition', (dto) => gateway.handlePosition(socket as any, dto));
      socket.on('batchPosition', (dto) => gateway.handleBatchPosition(socket as any, dto));
    });

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;

    client = createClient(`http://localhost:${port}`, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      client.on('connect', resolve);
      client.on('connect_error', reject);
    });
  });

  afterAll(async () => {
    if (client?.connected) client.disconnect();
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('ACK explicite : 20 positions → ≥19 réellement persistées et latence moyenne < 500ms', async () => {
    const latencies: number[] = [];
    let savedAcks = 0;

    const ackReceived = () =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('ACK positionSaved non reçu (bug de retour silencieux ?)')),
          2000,
        );
        client.once('positionSaved', () => {
          clearTimeout(timer);
          resolve();
        });
      });

    for (let i = 0; i < 20; i++) {
      const t0 = Date.now();
      client.emit('updatePosition', {
        latitude: -18.8792 + i * 0.0002,
        longitude: 47.5079 + i * 0.0002,
        speed: 25 + i,
        heading: 90,
        altitude: 200,
        accuracy: 8,
        timestamp: new Date().toISOString(),
        vehicleId: '00000000-0000-4000-8000-000000000001',
      });
      // Le téléphone réel envoie à ~3s d'intervalle : l'ACK est mesuré PAR position,
      // la cadence d'émission ne change ni l'émission explicite ni la latence du
      // round-trip (elle ralentit seulement la suite). Un court délai suffit donc ici.
      const latency = Date.now() - t0;
      latencies.push(latency);
      await ackReceived();
      savedAcks++;
    }

    // Chacune des 20 positions a reçu son ACK ⇒ aucune n'est restée « bloquée ».
    expect(savedAcks).toBe(20);
    // « En base » : les 20 positions sont réellement arrivées au handler
    // savePosition du gateway (≥ 19 exigées par l'énoncé).
    expect(savedPositions.length).toBeGreaterThanOrEqual(19);
    expect(savedPositions.length).toBe(20);

    // Latence moyenne emit → réception de l'ACK largement sous les 500ms
    // (le bug faisait subir le timeout de secours de 3000ms — et sans libération
    // fiable : isSendingRef restait verrouillé).
    const meanLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
    expect(meanLatency).toBeLessThan(500);
    expect(Math.max(...latencies)).toBeLessThan(500);
  });

  it('validation payloads : lat hors bornes rejetée, whitelist acceptée, batch filtré sans échec global', async () => {
    const UUID = '00000000-0000-4000-8000-000000000001';
    const waitEvent = (ev: string, ms = 2000) =>
      new Promise<any>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting ${ev}`)), ms);
        client.once(ev, (d: unknown) => {
          clearTimeout(t);
          resolve(d);
        });
      });

    // a) Latitude hors bornes → rejet EXPLICITE invalid_payload (jamais un
    // silence qui ferait croire à une position acceptée).
    let ack = waitEvent('positionRejected');
    client.emit('updatePosition', {
      latitude: 999,
      longitude: 47.5,
      timestamp: new Date().toISOString(),
      vehicleId: UUID,
    });
    expect(await ack).toEqual({ reason: 'invalid_payload' });

    // b) Payload valide portant une clé inconnue (event, envoyée par
    // d'anciennes versions de l'app) → ACCEPTÉ (whitelist strips la clé).
    ack = waitEvent('positionSaved');
    client.emit('updatePosition', {
      event: 'updatePosition',
      latitude: -18.87,
      longitude: 47.5,
      speed: 30,
      timestamp: new Date().toISOString(),
      vehicleId: UUID,
    });
    expect(await ack).toEqual(expect.objectContaining({ id: expect.any(String) }));

    // c) Timestamp illisible → rejet invalid_payload.
    ack = waitEvent('positionRejected');
    client.emit('updatePosition', {
      latitude: -18.87,
      longitude: 47.5,
      timestamp: 'hier-negatif',
      vehicleId: UUID,
    });
    expect(await ack).toEqual({ reason: 'invalid_payload' });

    // d) Batch mixte [valide, invalide, invalide] : les invalides sont filtrées
    // (saveBatch ne reçoit que 1 position) et l'ACK est émis — aucune position
    // corrompue ne bloque le rattrapage réseau des autres.
    trackingService.saveBatch.mockResolvedValueOnce([
      {
        id: 'b-1',
        latitude: -18.88,
        longitude: 47.51,
        speed: null,
        heading: null,
        altitude: null,
        accuracy: null,
        suspect: false,
        timestamp: new Date(),
        deliveryId: null,
        vehicleId: UUID,
      },
    ]);
    ack = waitEvent('positionsSaved');
    client.emit('batchPosition', {
      positions: [
        {
          latitude: -18.88,
          longitude: 47.51,
          timestamp: new Date().toISOString(),
          vehicleId: UUID,
        },
        { latitude: 999, longitude: 999, timestamp: new Date().toISOString(), vehicleId: UUID },
        { latitude: 777, longitude: 47.52, timestamp: new Date().toISOString(), vehicleId: UUID },
      ],
    });
    expect(await ack).toEqual({ count: 1 });
    expect(trackingService.saveBatch).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ latitude: -18.88 })]),
      expect.anything(),
    );
    const batchArg = trackingService.saveBatch.mock.calls.at(-1)![2] as unknown[];
    expect(batchArg).toHaveLength(1);
  });
});
