import { NotFoundException } from '@nestjs/common';
import { TrackingGateway } from './tracking.gateway';

const mockSocket = () => {
  const rooms = new Set<string>();
  return {
    data: { user: null },
    join: jest.fn((room: string) => rooms.add(room)),
    leave: jest.fn((room: string) => rooms.delete(room)),
    emit: jest.fn(),
    rooms,
  } as any;
};

describe('TrackingGateway — cross-tenant security', () => {
  let gateway: TrackingGateway;
  let trackingService: {
    getDeliveryInfo: jest.Mock;
    saveBatch: jest.Mock;
    findDriverByUserId: jest.Mock;
    assertVehicleOwnership: jest.Mock;
    isRateLimited: jest.Mock;
    verifyDriverAssignment: jest.Mock;
    getLastPosition: jest.Mock;
    savePosition: jest.Mock;
  };
  let mockServer: { to: jest.Mock; emit: jest.Mock };
  let deliveryProximityService: { snoozeProximity: jest.Mock };

  beforeEach(async () => {
    trackingService = {
      getDeliveryInfo: jest.fn(),
      saveBatch: jest.fn(),
      findDriverByUserId: jest.fn(),
      assertVehicleOwnership: jest.fn(),
      isRateLimited: jest.fn().mockResolvedValue(false),
      verifyDriverAssignment: jest.fn(),
      getLastPosition: jest.fn().mockResolvedValue(null),
      savePosition: jest.fn().mockResolvedValue({ id: 'pos-1', suspect: false }),
    };
    deliveryProximityService = { snoozeProximity: jest.fn() };

    const mockEventEmitter = { on: jest.fn(), emit: jest.fn() };
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    gateway = new TrackingGateway(
      trackingService as any,
      {} as any, // wsAuthService mock
      mockEventEmitter as any, // dataUpdateBus
      deliveryProximityService as any, // deliveryProximityService mock
    );
    (gateway as any).server = mockServer;
  });

  describe('handleSubscribeToDelivery', () => {
    it('rejects when user is missing', async () => {
      const client = mockSocket();
      await gateway.handleSubscribeToDelivery(client, 'delivery-1');
      expect(client.emit).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects when user is a driver', async () => {
      const client = mockSocket();
      client.data.user = { id: 'driver-1', role: 'driver', companyId: 'company-a' };
      await gateway.handleSubscribeToDelivery(client, 'delivery-1');
      expect(client.emit).not.toHaveBeenCalled();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects with error when delivery belongs to a DIFFERENT company (cross-tenant leak attempt)', async () => {
      const client = mockSocket();
      client.data.user = { id: 'user-1', role: 'dispatcher', companyId: 'company-a' };

      trackingService.getDeliveryInfo.mockRejectedValueOnce(
        new NotFoundException('Delivery not found'),
      );

      await gateway.handleSubscribeToDelivery(client, 'delivery-from-company-b');

      expect(trackingService.getDeliveryInfo).toHaveBeenCalledWith(
        'delivery-from-company-b',
        'company-a',
      );
      expect(client.emit).toHaveBeenCalledWith('error', 'Delivery not found or access denied');
      expect(client.join).not.toHaveBeenCalled();
    });

    it('allows subscription when the delivery belongs to the SAME company', async () => {
      const client = mockSocket();
      client.data.user = { id: 'user-1', role: 'dispatcher', companyId: 'company-a' };

      trackingService.getDeliveryInfo.mockResolvedValueOnce({
        id: 'delivery-a-1',
        title: 'Delivery in company A',
      });

      const result = await gateway.handleSubscribeToDelivery(client, 'delivery-a-1');

      expect(trackingService.getDeliveryInfo).toHaveBeenCalledWith('delivery-a-1', 'company-a');
      expect(client.join).toHaveBeenCalledWith('delivery:delivery-a-1');
      expect(result).toEqual({ event: 'subscribed', data: { deliveryId: 'delivery-a-1' } });
    });

    it('rejects invalid deliveryId (non-string)', async () => {
      const client = mockSocket();
      client.data.user = { id: 'user-1', role: 'dispatcher', companyId: 'company-a' };

      await gateway.handleSubscribeToDelivery(client, '' as any);

      expect(client.emit).toHaveBeenCalledWith('error', 'Invalid delivery ID');
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects when deliveryId is an empty string', async () => {
      const client = mockSocket();
      client.data.user = { id: 'user-1', role: 'dispatcher', companyId: 'company-a' };

      await gateway.handleSubscribeToDelivery(client, '');

      expect(client.emit).toHaveBeenCalledWith('error', 'Invalid delivery ID');
      expect(client.join).not.toHaveBeenCalled();
    });
  });

  describe('Company room — multi-tenant scope', () => {
    it('admins and dispatchers can subscribe to company room', async () => {
      const client = mockSocket();
      client.data.user = { id: 'admin-1', role: 'admin', companyId: 'company-a' };

      const result = await gateway.handleSubscribeToCompany(client);

      expect(result).toEqual({ event: 'subscribed', data: { companyId: 'company-a' } });
      expect(client.join).toHaveBeenCalledWith('company:company-a');
    });

    it('drivers cannot subscribe to company room', async () => {
      const client = mockSocket();
      client.data.user = { id: 'driver-1', role: 'driver', companyId: 'company-a' };

      const result = await gateway.handleSubscribeToCompany(client);

      expect(result).toBeUndefined();
      expect(client.join).not.toHaveBeenCalled();
    });

    it('handleConnection joins company room for all authenticated users', async () => {
      const client = mockSocket();
      const wsAuthService = {
        verify: jest.fn().mockResolvedValue({
          id: 'user-1',
          role: 'admin',
          companyId: 'company-a',
          firstName: 'A',
          lastName: 'B',
        }),
      };
      gateway['wsAuthService'] = wsAuthService as any;

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('company:company-a');
    });

    it('handleConnection joins driver room for drivers', async () => {
      const client = mockSocket();
      const wsAuthService = {
        verify: jest.fn().mockResolvedValue({
          id: 'driver-1',
          role: 'driver',
          companyId: 'company-a',
          firstName: 'A',
          lastName: 'B',
        }),
      };
      gateway['wsAuthService'] = wsAuthService as any;

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('driver:driver-1');
      expect(client.join).toHaveBeenCalledWith('company:company-a');
    });
  });

  describe('handleBatchPosition — broadcast integrity', () => {
    it('only broadcasts positions that were actually saved', async () => {
      const client = mockSocket();
      client.data.user = {
        id: 'user-1',
        role: 'driver',
        companyId: 'company-a',
        firstName: 'Test',
        lastName: 'Driver',
      };

      trackingService.findDriverByUserId.mockResolvedValueOnce({ id: 'driver-1' });
      trackingService.saveBatch.mockResolvedValueOnce([
        {
          id: 'pos-1',
          latitude: 1,
          longitude: 2,
          speed: 10,
          heading: 90,
          altitude: 0,
          accuracy: 5,
          suspect: false,
          timestamp: new Date('2026-07-21T10:00:00.000Z'),
          deliveryId: 'delivery-1',
          vehicleId: 'vehicle-1',
        },
      ]);

      const dto = {
        positions: [
          {
            latitude: 1,
            longitude: 2,
            speed: 10,
            heading: 90,
            altitude: 0,
            accuracy: 5,
            timestamp: '2026-07-21T10:00:00.000Z',
            deliveryId: 'delivery-1',
            vehicleId: 'vehicle-1',
          },
        ],
      };

      await gateway.handleBatchPosition(client, dto as any);

      expect(mockServer.to).toHaveBeenCalledWith('delivery:delivery-1');
      expect(mockServer.to).toHaveBeenCalledWith('company:company-a');
      // ACK explicite du batch reçu par le client (sans callback ack socket.io).
      expect(client.emit).toHaveBeenCalledWith('positionsSaved', { count: 1 });
    });

    it('handles positions without deliveryId (no delivery room)', async () => {
      const client = mockSocket();
      client.data.user = {
        id: 'user-1',
        role: 'driver',
        companyId: 'company-a',
        firstName: 'Test',
        lastName: 'Driver',
      };

      trackingService.findDriverByUserId.mockResolvedValueOnce({ id: 'driver-1' });
      trackingService.saveBatch.mockResolvedValueOnce([
        {
          id: 'pos-2',
          latitude: 3,
          longitude: 4,
          speed: null,
          heading: null,
          altitude: null,
          accuracy: null,
          suspect: false,
          timestamp: new Date(),
          deliveryId: null,
          vehicleId: 'vehicle-1',
        },
      ]);

      const dto = {
        positions: [
          {
            latitude: 3,
            longitude: 4,
            timestamp: '2026-07-21T10:00:00.000Z',
            vehicleId: 'vehicle-1',
          },
        ],
      };

      await gateway.handleBatchPosition(client, dto as any);

      // Should broadcast to company room, NOT to delivery:undefined
      expect(mockServer.to).not.toHaveBeenCalledWith('delivery:undefined');
      expect(mockServer.to).toHaveBeenCalledWith('company:company-a');
      // ACK explicite : le client apprend que 1 position a bien été persistée.
      expect(client.emit).toHaveBeenCalledWith('positionsSaved', { count: 1 });
    });
  });

  describe('handlePosition — cross-tenant vehicle ownership', () => {
    const positionDto = (overrides: Record<string, unknown> = {}) => ({
      latitude: -18.8792,
      longitude: 47.5079,
      speed: 10,
      heading: 90,
      altitude: 100,
      accuracy: 10,
      timestamp: new Date().toISOString(),
      vehicleId: 'vehicle-b-1',
      ...overrides,
    });

    function setupDriverClient(companyId = 'company-a') {
      const client = mockSocket();
      client.data.user = { id: 'driver-1', role: 'driver', companyId };
      trackingService.findDriverByUserId.mockResolvedValue({ id: 'driver-1' });
      return client;
    }

    it('rejects position when vehicle belongs to a DIFFERENT company', async () => {
      const client = setupDriverClient('company-a');
      trackingService.assertVehicleOwnership.mockRejectedValueOnce(
        new NotFoundException('Vehicle not found or access denied'),
      );

      await gateway.handlePosition(client, positionDto());

      // Rejet EXPLICITE (jamais de return silencieux qui bloquerait le client).
      expect(client.emit).toHaveBeenCalledWith('positionRejected', { reason: 'vehicle_mismatch' });
      // getLastPosition should NOT be called (ownership check happens first)
      expect(trackingService.getLastPosition).not.toHaveBeenCalled();
      // savePosition should NOT be called either
      expect(trackingService.savePosition).not.toHaveBeenCalled();
      // assertVehicleOwnership was called with the right params
      expect(trackingService.assertVehicleOwnership).toHaveBeenCalledWith(
        'vehicle-b-1',
        'company-a',
      );
    });

    it('rejects position when the driver is NOT assigned to the delivery', async () => {
      const client = setupDriverClient('company-a');
      trackingService.verifyDriverAssignment.mockRejectedValueOnce(
        new NotFoundException('Driver is not assigned to this delivery'),
      );

      await gateway.handlePosition(client, positionDto({ deliveryId: 'delivery-b-1' }));

      // Rejet EXPLICITE avec le motif not_assigned : le client débloque isSendingRef
      // immédiatement au lieu d'attendre son timeout de secours.
      expect(client.emit).toHaveBeenCalledWith('positionRejected', { reason: 'not_assigned' });
      expect(trackingService.assertVehicleOwnership).not.toHaveBeenCalled();
      expect(trackingService.savePosition).not.toHaveBeenCalled();
    });

    it('allows position when vehicle belongs to the SAME company', async () => {
      const client = setupDriverClient('company-a');
      trackingService.assertVehicleOwnership.mockResolvedValueOnce(undefined);
      trackingService.savePosition.mockResolvedValueOnce({
        id: 'pos-ok',
        speed: 10,
        latitude: -18.8792,
        longitude: 47.5079,
        heading: 90,
        altitude: 100,
        accuracy: 10,
        suspect: false,
        timestamp: new Date(),
        deliveryId: null,
        vehicleId: 'vehicle-a-1',
      });

      await gateway.handlePosition(client, positionDto({ vehicleId: 'vehicle-a-1' }));

      expect(trackingService.assertVehicleOwnership).toHaveBeenCalledWith(
        'vehicle-a-1',
        'company-a',
      );
      expect(trackingService.savePosition).toHaveBeenCalled();
      // ACK EXPLICITE de succès : c'est lui qui libère isSendingRef côté téléphone.
      expect(client.emit).toHaveBeenCalledWith('positionSaved', {
        id: 'pos-ok',
        suspect: false,
      });
    });

    it('emits positionRejected with reason rate_limited when the send is rate limited', async () => {
      const client = setupDriverClient('company-a');
      trackingService.isRateLimited.mockResolvedValueOnce(true);

      await gateway.handlePosition(client, positionDto());

      // Émission EXPLICITE (client.emit) : une valeur retournée par un handler
      // @SubscribeMessage ne remonte au client QUE s'il a fourni un callback ack
      // — l'app mobile ne le fait pas.
      expect(client.emit).toHaveBeenCalledWith('positionRejected', { reason: 'rate_limited' });
      // Rien d'autre n'est exécuté (ni ownership ni savePosition).
      expect(trackingService.assertVehicleOwnership).not.toHaveBeenCalled();
      expect(trackingService.savePosition).not.toHaveBeenCalled();
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('emits positionRejected when savePosition returns null (vehicle disabled/misconfigured)', async () => {
      const client = setupDriverClient('company-a');
      trackingService.assertVehicleOwnership.mockResolvedValueOnce(undefined);
      // Véhicule désactivé / mal configuré → savePosition refuse la position.
      trackingService.savePosition.mockResolvedValueOnce(null);

      await gateway.handlePosition(client, positionDto());

      // Le client reçoit un échec EXPLICITE (motif générique, sans fuite interne),
      // pour qu'il puisse remettre la position en file au lieu de la perdre.
      expect(client.emit).toHaveBeenCalledWith('positionRejected', { reason: 'rejected' });
      // Aucun broadcast de la position rejetée.
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('does not call getLastPosition when assertVehicleOwnership fails', async () => {
      const client = setupDriverClient('company-a');
      trackingService.assertVehicleOwnership.mockRejectedValueOnce(
        new NotFoundException('Vehicle not found or access denied'),
      );

      // getLastPosition has a spy but should never be called
      await gateway.handlePosition(client, positionDto({ vehicleId: 'vehicle-b-1' }));

      expect(trackingService.getLastPosition).not.toHaveBeenCalled();
      // Le client est débloqué explicitement (jamais de retour silencieux).
      expect(client.emit).toHaveBeenCalledWith('positionRejected', { reason: 'vehicle_mismatch' });
    });

    it('persists the recalculated fallback speed when dto.speed is missing', async () => {
      trackingService.getLastPosition.mockResolvedValue({
        latitude: -18.8792,
        longitude: 47.5079,
        timestamp: new Date('2026-08-10T10:00:00.000Z'),
      });
      const client = mockSocket();
      client.data.user = {
        id: 'u1',
        companyId: 'c1',
        role: 'driver',
        firstName: 'A',
        lastName: 'B',
      };
      trackingService.findDriverByUserId.mockResolvedValue({ id: 'd1' });
      trackingService.assertVehicleOwnership.mockResolvedValue(undefined);

      await gateway.handlePosition(client, {
        latitude: -18.88,
        longitude: 47.5085, // ~100m
        speed: undefined,
        timestamp: '2026-08-10T10:00:10.000Z', // +10s
        vehicleId: '11111111-1111-4111-8111-111111111111',
      } as any);

      const savedDto = trackingService.savePosition.mock.calls[0][1];
      expect(savedDto.speed).toBeGreaterThan(5);
      expect(savedDto.speed).toBeLessThan(15);
    });
  });

  describe('handleSnoozeProximityAlert', () => {
    it('rejects snooze when the driver is not assigned to the delivery', async () => {
      const client = mockSocket();
      client.data.user = { id: 'driver-user-1', role: 'driver', companyId: 'company-a' };
      trackingService.verifyDriverAssignment.mockRejectedValueOnce(
        new NotFoundException('Driver is not assigned to this delivery'),
      );

      await gateway.handleSnoozeProximityAlert(client, {
        deliveryId: 'delivery-1',
        escalationLevel: 0,
      });

      expect(deliveryProximityService.snoozeProximity).not.toHaveBeenCalled();
    });

    it('snoozes using the vehicleId derived from the authenticated driver session', async () => {
      const client = mockSocket();
      client.data.user = { id: 'driver-user-1', role: 'driver', companyId: 'company-a' };
      trackingService.verifyDriverAssignment.mockResolvedValueOnce(undefined);
      trackingService.findDriverByUserId.mockResolvedValueOnce({
        id: 'driver-1',
        vehicleId: 'vehicle-1',
      });

      await gateway.handleSnoozeProximityAlert(client, {
        deliveryId: 'delivery-1',
        escalationLevel: 2,
      });

      expect(deliveryProximityService.snoozeProximity).toHaveBeenCalledWith(
        'delivery-1',
        'vehicle-1',
        2,
      );
    });

    it('does nothing for non-driver roles', async () => {
      const client = mockSocket();
      client.data.user = { id: 'admin-1', role: 'admin', companyId: 'company-a' };

      await gateway.handleSnoozeProximityAlert(client, {
        deliveryId: 'delivery-1',
        escalationLevel: 0,
      });

      expect(trackingService.verifyDriverAssignment).not.toHaveBeenCalled();
      expect(deliveryProximityService.snoozeProximity).not.toHaveBeenCalled();
    });
  });
});
