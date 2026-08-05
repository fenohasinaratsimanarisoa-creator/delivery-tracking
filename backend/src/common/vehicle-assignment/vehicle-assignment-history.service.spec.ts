import { PrismaService } from '../prisma/prisma.service';
import { DataUpdateBus } from '../events/data-update.bus';
import { VehicleAssignmentHistoryService } from './vehicle-assignment-history.service';
import { DriversService } from '../../modules/drivers/drivers.service';

// ---------------------------------------------------------------------------
// Fake Prisma "fidèle" : les opérations find/create/update s'exécutent sur un
// store en mémoire avec une vraie sémantique de filtrage. Les requêtes
// "Prisma directes" faites par le test (findMany/findFirst sur
// vehicleAssignmentHistory et driver) interrogent donc réellement l'état produit
// par les services, pas des valeurs pré-usinées.
// ---------------------------------------------------------------------------

interface HistoryRow {
  id: string;
  companyId: string;
  vehicleId: string;
  driverId: string;
  assignedAt: Date;
  unassignedAt: Date | null;
}

interface DriverRow {
  id: string;
  companyId: string;
  licenseNumber: string;
  vehicleId: string | null;
  deletedAt: Date | null;
  firstName: string;
  lastName: string;
}

const historyStore: HistoryRow[] = [];
const driverStore: DriverRow[] = [];
let seq = 0;

const eq = (val: unknown, cond: unknown): boolean => {
  if (cond === null) return val === null || val === undefined;
  if (cond && typeof cond === 'object' && 'not' in cond) {
    const not = (cond as { not: unknown }).not;
    if (not === null) return val !== null && val !== undefined;
    return val !== not;
  }
  return val === cond;
};

const matches = (row: Record<string, unknown>, where?: Record<string, unknown>): boolean => {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => eq(row[key], cond));
};

const mockPrisma: any = {
  driver: {
    findFirst: jest.fn(
      async ({ where }: { where?: Record<string, unknown> }) =>
        driverStore.find((r) => matches(r as unknown as Record<string, unknown>, where)) ?? null,
    ),
    findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> }) =>
      driverStore.filter((r) => matches(r as unknown as Record<string, unknown>, where)),
    ),
    create: jest.fn(async ({ data }: { data: any }) => {
      const row: DriverRow = {
        id: `driver-${++seq}`,
        companyId: data.companyId,
        licenseNumber: data.licenseNumber,
        vehicleId: data.vehicleId ?? null,
        deletedAt: null,
        firstName: data.firstName,
        lastName: data.lastName,
      };
      driverStore.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
      const row = driverStore.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
  },
  vehicle: {
    findFirst: jest.fn(async ({ where }: { where?: Record<string, unknown> }) => {
      if (where?.id === 'V' && where?.companyId === 'company-1' && where?.deletedAt === null) {
        return { id: 'V', companyId: 'company-1' };
      }
      return null;
    }),
  },
  delivery: {
    findFirst: jest.fn(async () => null),
  },
  vehicleAssignmentHistory: {
    findFirst: jest.fn(
      async ({ where }: { where?: Record<string, unknown> }) =>
        historyStore.find((r) => matches(r as unknown as Record<string, unknown>, where)) ?? null,
    ),
    findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> }) =>
      historyStore.filter((r) => matches(r as unknown as Record<string, unknown>, where)),
    ),
    create: jest.fn(async ({ data }: { data: any }) => {
      const row: HistoryRow = {
        id: `history-${++seq}`,
        companyId: data.companyId,
        vehicleId: data.vehicleId,
        driverId: data.driverId,
        assignedAt: data.assignedAt,
        unassignedAt: data.unassignedAt ?? null,
      };
      historyStore.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
      const row = historyStore.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: { where?: Record<string, unknown>; data: any }) => {
      let count = 0;
      for (const row of historyStore) {
        if (matches(row as unknown as Record<string, unknown>, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    }),
  },
  $transaction: jest.fn((arg: any) =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
  ),
};

describe('VehicleAssignmentHistory — invariant de réaffectation', () => {
  const companyId = 'company-1';
  let driversService: DriversService;

  beforeEach(() => {
    jest.clearAllMocks();
    historyStore.length = 0;
    driverStore.length = 0;
    seq = 0;
    driversService = new DriversService(
      mockPrisma as unknown as PrismaService,
      { emitUpdate: jest.fn() } as any,
      new VehicleAssignmentHistoryService(),
    );
  });

  it('assigne driver A → vehicle V, réassigne V → driver B : exactement 2 lignes pour V (1 fermée, 1 ouverte) et driver.vehicleId à jour', async () => {
    // 1. Driver A affecté au véhicule V.
    const driverA = await driversService.create(companyId, {
      firstName: 'Alice',
      lastName: 'A',
      licenseNumber: 'LIC-A',
      vehicleId: 'V',
    });
    expect(driverA.vehicleId).toBe('V');
    expect(
      await mockPrisma.vehicleAssignmentHistory.findMany({ where: { vehicleId: 'V' } }),
    ).toHaveLength(1);

    // 2. Driver B créé sans véhicule.
    const driverB = await driversService.create(companyId, {
      firstName: 'Bob',
      lastName: 'B',
      licenseNumber: 'LIC-B',
    });
    expect(driverB.vehicleId).toBeNull();

    // 3. Réaffectation : A est désaffecté de V, puis V est réassigné à B.
    await driversService.update(companyId, driverA.id, { vehicleId: null } as any);
    const updatedB = await driversService.update(companyId, driverB.id, { vehicleId: 'V' });
    expect(updatedB.vehicleId).toBe('V');

    // 4. Requête Prisma directe : exactement 2 lignes VehicleAssignmentHistory pour V.
    const rowsForV = (await mockPrisma.vehicleAssignmentHistory.findMany({
      where: { vehicleId: 'V' },
    })) as HistoryRow[];
    expect(rowsForV).toHaveLength(2);

    const open = rowsForV.filter((r) => r.unassignedAt === null);
    const closed = rowsForV.filter((r) => r.unassignedAt !== null);
    expect(open).toHaveLength(1);
    expect(closed).toHaveLength(1);
    // La ligne fermée est l'affectation A, la ligne ouverte est l'affectation B.
    expect(closed[0].driverId).toBe(driverA.id);
    expect(open[0].driverId).toBe(driverB.id);
    // La ligne ouverte a été ouverte après la fermeture de l'ancienne.
    expect(open[0].assignedAt.getTime()).toBeGreaterThanOrEqual(closed[0].assignedAt.getTime());

    // 5. driver.vehicleId reflète l'état courant : A n'a plus V, B a V.
    const driverACurrent = await mockPrisma.driver.findFirst({ where: { id: driverA.id } });
    const driverBCurrent = await mockPrisma.driver.findFirst({ where: { id: driverB.id } });
    expect(driverACurrent.vehicleId).toBeNull();
    expect(driverBCurrent.vehicleId).toBe('V');
  });
});
