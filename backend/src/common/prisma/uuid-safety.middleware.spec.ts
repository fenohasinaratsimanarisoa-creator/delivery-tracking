import { uuidSafetyMiddleware } from './uuid-safety.middleware';

describe('uuidSafetyMiddleware', () => {
  it('converts empty string deliveryId in where clause to null', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return { id: 'test' };
    });

    await uuidSafetyMiddleware(
      {
        model: 'GpsPosition',
        action: 'findFirst',
        args: { where: { vehicleId: 'uuid-1', deliveryId: '' } },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    expect(capturedArgs.where.deliveryId).toBeNull();
    expect(capturedArgs.where.vehicleId).toBe('uuid-1');
    expect(next).toHaveBeenCalled();
  });

  it('converts empty string id in where clause to null', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return { id: 'test' };
    });

    await uuidSafetyMiddleware(
      {
        model: 'Delivery',
        action: 'findUnique',
        args: { where: { id: '' } },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    expect(capturedArgs.where.id).toBeNull();
    expect(next).toHaveBeenCalled();
  });

  it('does NOT modify null or undefined values', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return { id: 'test' };
    });

    await uuidSafetyMiddleware(
      {
        model: 'GpsPosition',
        action: 'findFirst',
        args: { where: { vehicleId: 'uuid-1', deliveryId: null } },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    expect(capturedArgs.where.deliveryId).toBeNull();
    expect(capturedArgs.where.vehicleId).toBe('uuid-1');
  });

  it('does NOT modify valid UUID strings', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return { id: 'test' };
    });

    await uuidSafetyMiddleware(
      {
        model: 'GpsPosition',
        action: 'findFirst',
        args: {
          where: {
            vehicleId: '550e8400-e29b-41d4-a716-446655440000',
            deliveryId: '550e8400-e29b-41d4-a716-446655440001',
          },
        },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    expect(capturedArgs.where.deliveryId).toBe('550e8400-e29b-41d4-a716-446655440001');
    expect(capturedArgs.where.vehicleId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('sanitizes empty string Id fields in create data', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return { id: 'test' };
    });

    await uuidSafetyMiddleware(
      {
        model: 'GpsPosition',
        action: 'create',
        args: {
          data: {
            latitude: 1,
            longitude: 2,
            timestamp: new Date(),
            vehicleId: '',
            deliveryId: undefined,
            driverId: '',
          },
        },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    expect(capturedArgs.data.vehicleId).toBeNull();
    expect(capturedArgs.data.driverId).toBeNull();
    expect(capturedArgs.data.deliveryId).toBeUndefined();
  });

  it('sanitizes nested where inside array (findMany with OR)', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return [];
    });

    await uuidSafetyMiddleware(
      {
        model: 'Delivery',
        action: 'findMany',
        args: {
          where: {
            OR: [{ driverId: '' }, { assignedDriverId: 'valid-uuid' }],
          },
        },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    const or = capturedArgs.where.OR as any[];
    expect(or[0].driverId).toBeNull();
    expect(or[1].assignedDriverId).toBe('valid-uuid');
  });

  it('does NOT modify non-Id string fields (description, name, etc.)', async () => {
    let capturedArgs: any;
    const next = jest.fn(async (params: any) => {
      capturedArgs = params.args;
      return { id: 'test' };
    });

    await uuidSafetyMiddleware(
      {
        model: 'Delivery',
        action: 'create',
        args: {
          data: {
            title: '',
            description: '',
            pickupAddress: '',
          },
        },
        dataPath: [],
        runInTransaction: false,
      } as any,
      next,
    );

    expect(capturedArgs.data.title).toBe('');
    expect(capturedArgs.data.description).toBe('');
    expect(capturedArgs.data.pickupAddress).toBe('');
  });
});
