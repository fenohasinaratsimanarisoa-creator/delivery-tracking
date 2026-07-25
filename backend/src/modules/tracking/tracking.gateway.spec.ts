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
  let trackingService: { getDeliveryInfo: jest.Mock };

  beforeEach(async () => {
    trackingService = {
      getDeliveryInfo: jest.fn(),
    };

    const mockEventEmitter = { on: jest.fn(), emit: jest.fn() };

    gateway = new TrackingGateway(
      trackingService as any,
      {} as any, // wsAuthService mock
      mockEventEmitter as any, // dataUpdateBus
    );
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
});
