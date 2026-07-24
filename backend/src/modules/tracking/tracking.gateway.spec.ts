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

    gateway = new TrackingGateway(
      trackingService as any,
      {} as any, // wsAuthService mock (not needed in these tests)
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
});
