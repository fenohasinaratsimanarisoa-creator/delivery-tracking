import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { GpsDataQuality } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RoutingService } from '../routing/routing.service';
import { FuelConsumptionService } from './fuel-consumption.service';

// =============================================================================
// CHANTIER OSRM (audit sous-comptage carburant 2026-09-15) : vérifie le
// câblage RoutingService → computeRouteMatchedDistance → DailyFuelReport dans
// upsertDailyReportForVehicleGroup(). Les tests de geo/route-distance.spec.ts
// couvrent déjà la logique pure de découpage/repli ; ceux-ci couvrent
// uniquement l'INTÉGRATION (coupe-circuit config, absence de RoutingService,
// échec OSRM gracieux) au niveau du service.
// =============================================================================

const mockQueue = { add: jest.fn().mockResolvedValue(undefined) };

const mockPrisma = {
  vehicle: { findFirst: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  fuelLog: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  fuelPriceHistory: { findFirst: jest.fn() },
  companyFuelSettings: { findUnique: jest.fn() },
  dailyFuelReport: { upsert: jest.fn() },
  driver: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
  gpsPosition: { findMany: jest.fn(), findFirst: jest.fn() },
};

const mockConfigService = { get: jest.fn() };
const mockNotifications = { create: jest.fn() };
const mockTrackingGateway = { broadcastDataUpdate: jest.fn() };

const DRIVER = { id: 'driver-1', firstName: 'Jean', lastName: 'Rakoto' };
const VEHICLE = {
  id: 'vehicle-1',
  licensePlate: 'TRK-001',
  fuelType: 'Essence',
  theoreticalConsumption: 5,
};
const TARGET_DATE = new Date('2026-09-14T12:00:00.000Z');
const T0 = new Date('2026-09-14T09:00:00.000Z').getTime();
const at = (i: number) => new Date(T0 + i * 5000);

// 10 fixes, ~30 m/pas → corde brute ≈ 270 m (confortablement au-dessus du
// seuil gpsDataQuality=sufficient, même après filtrage) ; OSRM renverra une
// distance « route réelle » plus grande, comme dans le cas terrain audité.
const TIMESTAMPED_POSITIONS = Array.from({ length: 10 }, (_, i) => ({
  latitude: (30 * i) / 111320,
  longitude: 0,
  accuracy: 8,
  speed: 0,
  vehicleId: 'vehicle-1',
  timestamp: at(i),
}));

function buildService(
  routingService: RoutingService | undefined,
  configOverrides: Record<string, unknown> = {},
) {
  return new FuelConsumptionService(
    mockPrisma as unknown as PrismaService,
    mockConfigService as unknown as ConfigService,
    mockNotifications as unknown as NotificationsService,
    mockQueue as unknown as any,
    mockTrackingGateway as any,
    null,
    routingService,
  );
}

describe('FuelConsumptionService — intégration OSRM (audit sous-comptage carburant 2026-09-15)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockConfigService.get.mockImplementation((_key: string, def?: unknown) => def);
    mockPrisma.fuelPriceHistory.findFirst.mockResolvedValue({ pricePerLiter: 5000 });
    mockPrisma.gpsPosition.findMany.mockResolvedValue(TIMESTAMPED_POSITIONS);
    mockPrisma.vehicle.findUnique.mockResolvedValue(VEHICLE);
    mockPrisma.vehicle.findMany.mockResolvedValue([]);
    mockPrisma.dailyFuelReport.upsert.mockImplementation(async (args: any) => args);
    mockPrisma.driver.findFirst.mockResolvedValue(DRIVER);
  });

  it('utilise la distance accrochée route quand RoutingService est fourni et confiant', async () => {
    const matchRouteDistance = jest.fn().mockResolvedValue({ distance: 500, confidence: 0.95 });
    const routingService = { matchRouteDistance } as unknown as RoutingService;
    const service = buildService(routingService);

    await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

    expect(matchRouteDistance).toHaveBeenCalled();
    const payload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
    // 500 m OSRM contre ~100 m de corde brute : la distance retenue doit refléter OSRM.
    expect(payload.create.distanceKm).toBeCloseTo(0.5, 2);
  });

  it('retombe sur computeFilteredDistance quand FUEL_REPORT_MAP_MATCHING_ENABLED=false, même avec RoutingService fourni', async () => {
    mockConfigService.get.mockImplementation((key: string, def?: unknown) =>
      key === 'FUEL_REPORT_MAP_MATCHING_ENABLED' ? 'false' : def,
    );
    const matchRouteDistance = jest.fn().mockResolvedValue({ distance: 500, confidence: 0.95 });
    const routingService = { matchRouteDistance } as unknown as RoutingService;
    const service = buildService(routingService);

    await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

    expect(matchRouteDistance).not.toHaveBeenCalled();
    const payload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
    // ≈ corde brute filtrée (~0.27 km), nettement sous les 0.5 km renvoyés par OSRM.
    expect(payload.create.distanceKm).toBeGreaterThan(0.2);
    expect(payload.create.distanceKm).toBeLessThan(0.35);
  });

  it('sans RoutingService injecté (Optional, non câblé) : repli intégral, aucun crash', async () => {
    const service = buildService(undefined);

    await service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE);

    const payload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
    expect(payload.create.distanceKm).toBeGreaterThanOrEqual(0);
  });

  it('échec OSRM (rejet/erreur réseau) : le rapport est quand même généré, sur la distance filtrée', async () => {
    const matchRouteDistance = jest.fn().mockRejectedValue(new Error('OSRM timeout'));
    const routingService = { matchRouteDistance } as unknown as RoutingService;
    const service = buildService(routingService);

    await expect(
      service.generateDailyReportForSingleDriver('company-1', 'driver-1', TARGET_DATE),
    ).resolves.not.toThrow();

    expect(mockPrisma.dailyFuelReport.upsert).toHaveBeenCalledTimes(1);
    const payload = mockPrisma.dailyFuelReport.upsert.mock.calls[0][0] as any;
    expect(payload.create.gpsDataQuality).toBe(GpsDataQuality.sufficient);
  });
});

// CHANTIER OSRM — EXTENSION scanVehicleTrack (audit sous-comptage carburant
// 2026-09-15) : crossCheckFuelLogWithGps() (vérification GPS d'un plein saisi
// manuellement) utilise scanVehicleTrack(), qui appelle désormais
// computeRouteMatchedDistance() avec un budget OSRM PARTAGÉ entre pages.
describe('FuelConsumptionService — crossCheckFuelLogWithGps utilise aussi l’accrochage OSRM (audit 2026-09-15)', () => {
  const FUEL_LOG = {
    id: 'fuel-log-1',
    vehicleId: 'vehicle-1',
    kilometers: 0.5,
    fillDate: new Date('2026-09-14T12:00:00.000Z'),
    vehicle: { licensePlate: 'TRK-001' },
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockConfigService.get.mockImplementation((_key: string, def?: unknown) => def);
    mockPrisma.fuelLog.findFirst.mockResolvedValue({
      fillDate: new Date('2026-09-14T08:00:00.000Z'),
    });
    mockPrisma.gpsPosition.findMany.mockResolvedValue(TIMESTAMPED_POSITIONS);
    mockPrisma.companyFuelSettings.findUnique.mockResolvedValue(null);
  });

  it('scanVehicleTrack() appelle RoutingService.matchRouteDistance quand disponible', async () => {
    const matchRouteDistance = jest.fn().mockResolvedValue({ distance: 500, confidence: 0.95 });
    const routingService = { matchRouteDistance } as unknown as RoutingService;
    const service = buildService(routingService);

    await (service as any).crossCheckFuelLogWithGps(FUEL_LOG, 'company-1');

    expect(matchRouteDistance).toHaveBeenCalled();
  });

  it('sans RoutingService : repli sur computeFilteredDistance, comportement inchangé', async () => {
    const service = buildService(undefined);

    await expect(
      (service as any).crossCheckFuelLogWithGps(FUEL_LOG, 'company-1'),
    ).resolves.not.toThrow();
  });
});

// AUDIT DI 2026-09-15 : le paramètre routingService avait initialement un
// type union AVEC valeur par défaut (`RoutingService | null = null`), ce qui
// fait perdre à TypeScript le type reflété dans `design:paramtypes` (émis
// comme `Object`) — Nest ne pouvait alors plus résoudre le provider par type
// et retombait silencieusement sur `undefined`, MÊME avec RoutingModule
// importé. Les tests ci-dessus construisent le service à la main
// (`new FuelConsumptionService(...)`) et ne passent donc jamais par le
// conteneur Nest réel — ils ne pouvaient pas détecter ce bug (constaté en
// prod : le rapport carburant retombait toujours sur computeFilteredDistance
// malgré FUEL_REPORT_MAP_MATCHING_ENABLED=true). Ce test verrouille
// directement la métadonnée de réflexion dont Nest a besoin pour l'injection
// automatique par type.
describe('FuelConsumptionService — métadonnée de réflexion DI (audit 2026-09-15)', () => {
  it('le paramètre routingService du constructeur reflète bien le type RoutingService (pas Object)', () => {
    const paramTypes = Reflect.getMetadata('design:paramtypes', FuelConsumptionService) as
      unknown[] | undefined;
    expect(paramTypes).toBeDefined();
    const routingServiceParamType = paramTypes![paramTypes!.length - 1];
    expect(routingServiceParamType).toBe(RoutingService);
    expect((routingServiceParamType as { name: string }).name).not.toBe('Object');
  });
});
