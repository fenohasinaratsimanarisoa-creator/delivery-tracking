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
  let trackingService: { getDeliveryInfo: jest.Mock; saveBatch: jest.Mock; findDriverByUserId: jest.Mock };
  let mockServer: { to: jest.Mock; emit: jest.Mock };

  beforeEach(async () => {
    trackingService = {
      getDeliveryInfo: jest.fn(),
      saveBatch: jest.fn(),
      findDriverByUserId: jest.fn(),
    };

    const mockEventEmitter = { on: jest.fn(), emit: jest.fn() };
    mockServer = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    };

    gateway = new TrackingGateway(
      trackingService as any,
      {} as any, // wsAuthService mock
      mockEventEmitter as any, // dataUpdateBus
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
      const wsAuthService = { verify: jest.fn().mockResolvedValue({ id: 'user-1', role: 'admin', companyId: 'company-a', firstName: 'A', lastName: 'B' }) };
      gateway['wsAuthService'] = wsAuthService as any;

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('company:company-a');
    });

    it('handleConnection joins driver room for drivers', async () => {
      const client = mockSocket();
      const wsAuthService = { verify: jest.fn().mockResolvedValue({ id: 'driver-1', role: 'driver', companyId: 'company-a', firstName: 'A', lastName: 'B' }) };
      gateway['wsAuthService'] = wsAuthService as any;

      await gateway.handleConnection(client);

      expect(client.join).toHaveBeenCalledWith('driver:driver-1');
      expect(client.join).toHaveBeenCalledWith('company:company-a');
    });
  });

  describe('handleBatchPosition — broadcast integrity', () => {
    it('only broadcasts positions that were actually saved', async () => {
      const client = mockSocket();
      client.data.user = { id: 'user-1', role: 'driver', companyId: 'company-a', firstName: 'Test', lastName: 'Driver' };

      trackingService.findDriverByUserId.mockResolvedValueOnce({ id: 'driver-1' });
      trackingService.saveBatch.mockResolvedValueOnce([
        { id: 'pos-1', latitude: 1, longitude: 2, speed: 10, heading: 90, altitude: 0, accuracy: 5, suspect: false, timestamp: new Date('2026-07-21T10:00:00.000Z'), deliveryId: 'delivery-1', vehicleId: 'vehicle-1' },
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
    });

    it('handles positions without deliveryId (no delivery room)', async () => {
      const client = mockSocket();
      client.data.user = { id: 'user-1', role: 'driver', companyId: 'company-a', firstName: 'Test', lastName: 'Driver' };

      trackingService.findDriverByUserId.mockResolvedValueOnce({ id: 'driver-1' });
      trackingService.saveBatch.mockResolvedValueOnce([
        { id: 'pos-2', latitude: 3, longitude: 4, speed: null, heading: null, altitude: null, accuracy: null, suspect: false, timestamp: new Date(), deliveryId: null, vehicleId: 'vehicle-1' },
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
    });
  });
});
