import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NotificationType, NotificationPriority } from '@prisma/client';
import { VehicleMaintenanceService } from './vehicle-maintenance.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const mockPrisma = {
  vehicle: {
    findFirst: jest.fn(),
  },
  vehicleMaintenanceSchedule: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  maintenanceRecord: {
    findFirst: jest.fn(),
  },
  dailyFuelReport: {
    aggregate: jest.fn(),
  },
  notification: {
    findFirst: jest.fn(),
  },
  company: {
    findMany: jest.fn(),
  },
};

const mockNotifications = {
  create: jest.fn(),
};

describe('VehicleMaintenanceService', () => {
  let service: VehicleMaintenanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VehicleMaintenanceService(
      mockPrisma as unknown as PrismaService,
      mockNotifications as unknown as NotificationsService,
      null,
    );
  });

  const vehicle = { id: 'veh-1', brand: 'Toyota', model: 'Hilux', licensePlate: 'TRK-001' };

  describe('create', () => {
    it("rejette si le véhicule n'appartient pas à l'entreprise", async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('comp-1', 'veh-1', { label: 'Vidange', type: 'vidange', intervalKm: 5000 }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.vehicleMaintenanceSchedule.create).not.toHaveBeenCalled();
    });

    it('rejette si ni intervalKm ni intervalMonths ne sont fournis', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);

      await expect(
        service.create('comp-1', 'veh-1', { label: 'Vidange', type: 'vidange' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.vehicleMaintenanceSchedule.create).not.toHaveBeenCalled();
    });

    it('crée la règle avec des intervalles valides', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);
      mockPrisma.vehicleMaintenanceSchedule.create.mockResolvedValueOnce({ id: 'sched-1' });

      await service.create('comp-1', 'veh-1', {
        label: 'Vidange',
        type: 'vidange',
        intervalKm: 5000,
        intervalMonths: 6,
      });

      expect(mockPrisma.vehicleMaintenanceSchedule.create).toHaveBeenCalledWith({
        data: {
          companyId: 'comp-1',
          vehicleId: 'veh-1',
          label: 'Vidange',
          type: 'vidange',
          intervalKm: 5000,
          intervalMonths: 6,
        },
      });
    });
  });

  describe('update', () => {
    it("rejette si la règle n'existe pas dans l'entreprise", async () => {
      mockPrisma.vehicleMaintenanceSchedule.findFirst.mockResolvedValueOnce(null);

      await expect(service.update('comp-1', 'sched-1', { label: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejette si la mise à jour retirerait les DEUX intervalles (garde-fou runtime, même hors du typage DTO)', async () => {
      mockPrisma.vehicleMaintenanceSchedule.findFirst.mockResolvedValueOnce({
        id: 'sched-1',
        intervalKm: 5000,
        intervalMonths: null,
      });

      // `as any` : le DTO public ne permet pas d'exprimer "effacer explicitement"
      // (seulement "fournir une nouvelle valeur" ou "ne pas toucher"), mais le
      // garde-fou runtime doit quand même se déclencher si jamais un appelant
      // (futur endpoint, script) envoie explicitement null.
      await expect(
        service.update('comp-1', 'sched-1', { intervalKm: null } as any),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.vehicleMaintenanceSchedule.update).not.toHaveBeenCalled();
    });

    it("n'affecte pas l'intervalle existant quand le champ n'est simplement pas fourni (undefined)", async () => {
      mockPrisma.vehicleMaintenanceSchedule.findFirst.mockResolvedValueOnce({
        id: 'sched-1',
        intervalKm: 5000,
        intervalMonths: null,
      });
      mockPrisma.vehicleMaintenanceSchedule.update.mockResolvedValueOnce({ id: 'sched-1' });

      await service.update('comp-1', 'sched-1', { isActive: false });

      expect(mockPrisma.vehicleMaintenanceSchedule.update).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
        data: { isActive: false },
      });
    });

    it('met à jour normalement', async () => {
      mockPrisma.vehicleMaintenanceSchedule.findFirst.mockResolvedValueOnce({
        id: 'sched-1',
        intervalKm: 5000,
        intervalMonths: null,
      });
      mockPrisma.vehicleMaintenanceSchedule.update.mockResolvedValueOnce({ id: 'sched-1' });

      await service.update('comp-1', 'sched-1', { intervalKm: 8000 });

      expect(mockPrisma.vehicleMaintenanceSchedule.update).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
        data: { intervalKm: 8000 },
      });
    });
  });

  describe('remove', () => {
    it("rejette si la règle n'existe pas", async () => {
      mockPrisma.vehicleMaintenanceSchedule.findFirst.mockResolvedValueOnce(null);
      await expect(service.remove('comp-1', 'sched-1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.vehicleMaintenanceSchedule.delete).not.toHaveBeenCalled();
    });

    it('supprime normalement', async () => {
      mockPrisma.vehicleMaintenanceSchedule.findFirst.mockResolvedValueOnce({ id: 'sched-1' });
      mockPrisma.vehicleMaintenanceSchedule.delete.mockResolvedValueOnce({});
      await service.remove('comp-1', 'sched-1');
      expect(mockPrisma.vehicleMaintenanceSchedule.delete).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
      });
    });
  });

  describe('findAllForVehicle — calcul de statut', () => {
    const baseSchedule = {
      id: 'sched-1',
      label: 'Vidange',
      type: 'vidange',
      intervalKm: 5000,
      intervalMonths: null,
      isActive: true,
      vehicleId: 'veh-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    it("utilise la date du dernier MaintenanceRecord comme référence quand il existe", async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([baseSchedule]);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce({
        date: new Date('2026-06-01T00:00:00Z'),
      });
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 1200 } });

      const [result] = await service.findAllForVehicle('comp-1', 'veh-1');

      expect(mockPrisma.dailyFuelReport.aggregate).toHaveBeenCalledWith({
        where: { vehicleId: 'veh-1', reportDate: { gt: new Date('2026-06-01T00:00:00Z') } },
        _sum: { distanceKm: true },
      });
      expect(result.kmSinceService).toBe(1200);
      expect(result.kmRemaining).toBe(3800);
      expect(result.status).toBe('ok');
    });

    it("retombe sur la date de création de la règle si aucun MaintenanceRecord n'existe", async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([baseSchedule]);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 100 } });

      await service.findAllForVehicle('comp-1', 'veh-1');

      expect(mockPrisma.dailyFuelReport.aggregate).toHaveBeenCalledWith({
        where: { vehicleId: 'veh-1', reportDate: { gt: baseSchedule.createdAt } },
        _sum: { distanceKm: true },
      });
    });

    it("statut 'overdue' quand le kilométrage dépasse l'intervalle", async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([baseSchedule]);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 5200 } });

      const [result] = await service.findAllForVehicle('comp-1', 'veh-1');

      expect(result.kmRemaining).toBe(-200);
      expect(result.status).toBe('overdue');
    });

    it("statut 'upcoming' dans la zone d'avertissement (≤ 500 km restants)", async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([baseSchedule]);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 4600 } });

      const [result] = await service.findAllForVehicle('comp-1', 'veh-1');

      expect(result.kmRemaining).toBe(400);
      expect(result.status).toBe('upcoming');
    });

    it('gère une règle basée sur intervalMonths (échéance calendaire)', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);
      const dateSchedule = { ...baseSchedule, intervalKm: null, intervalMonths: 12 };
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([dateSchedule]);
      // Référence il y a 13 mois → échéance (12 mois) déjà dépassée.
      const thirteenMonthsAgo = new Date();
      thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce({ date: thirteenMonthsAgo });

      const [result] = await service.findAllForVehicle('comp-1', 'veh-1');

      expect(mockPrisma.dailyFuelReport.aggregate).not.toHaveBeenCalled();
      expect(result.kmSinceService).toBeNull();
      expect(result.status).toBe('overdue');
    });
  });

  describe('findDueSoon', () => {
    it("exclut les règles au statut 'ok' et trie overdue avant upcoming", async () => {
      const schedules = [
        {
          id: 'sched-ok',
          label: 'OK',
          type: 'vidange',
          intervalKm: 5000,
          intervalMonths: null,
          isActive: true,
          vehicleId: 'veh-1',
          createdAt: new Date('2026-01-01'),
          vehicle: { brand: 'Toyota', model: 'Hilux', licensePlate: 'TRK-001' },
        },
        {
          id: 'sched-upcoming',
          label: 'Upcoming',
          type: 'vidange',
          intervalKm: 5000,
          intervalMonths: null,
          isActive: true,
          vehicleId: 'veh-2',
          createdAt: new Date('2026-01-01'),
          vehicle: { brand: 'Renault', model: 'Kangoo', licensePlate: 'TRK-002' },
        },
        {
          id: 'sched-overdue',
          label: 'Overdue',
          type: 'vidange',
          intervalKm: 5000,
          intervalMonths: null,
          isActive: true,
          vehicleId: 'veh-3',
          createdAt: new Date('2026-01-01'),
          vehicle: { brand: 'Hyundai', model: 'H100', licensePlate: 'TRK-003' },
        },
      ];
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce(schedules);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValue(null);
      mockPrisma.dailyFuelReport.aggregate
        .mockResolvedValueOnce({ _sum: { distanceKm: 100 } }) // ok
        .mockResolvedValueOnce({ _sum: { distanceKm: 4600 } }) // upcoming
        .mockResolvedValueOnce({ _sum: { distanceKm: 5500 } }); // overdue

      const result = await service.findDueSoon('comp-1');

      expect(result.map((r) => r.id)).toEqual(['sched-overdue', 'sched-upcoming']);
    });
  });

  describe('checkDueMaintenances (cron)', () => {
    it('crée une Notification maintenance_due pour une règle due, avec le lien encodant le scheduleId', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([
        {
          id: 'sched-1',
          label: 'Vidange',
          type: 'vidange',
          intervalKm: 5000,
          intervalMonths: null,
          isActive: true,
          vehicleId: 'veh-1',
          createdAt: new Date('2026-01-01'),
          vehicle: { brand: 'Toyota', model: 'Hilux', licensePlate: 'TRK-001' },
        },
      ]);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 5100 } });
      mockPrisma.notification.findFirst.mockResolvedValueOnce(null); // pas d'alerte déjà en cours

      await service.checkDueMaintenances();

      expect(mockNotifications.create).toHaveBeenCalledWith(
        'comp-1',
        expect.objectContaining({
          type: NotificationType.maintenance_due,
          priority: NotificationPriority.high,
          link: '/vehicles?maintenanceScheduleId=sched-1',
        }),
      );
    });

    it('ne recrée PAS de notification si une alerte non résolue existe déjà pour cette règle', async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-1' }]);
      mockPrisma.vehicleMaintenanceSchedule.findMany.mockResolvedValueOnce([
        {
          id: 'sched-1',
          label: 'Vidange',
          type: 'vidange',
          intervalKm: 5000,
          intervalMonths: null,
          isActive: true,
          vehicleId: 'veh-1',
          createdAt: new Date('2026-01-01'),
          vehicle: { brand: 'Toyota', model: 'Hilux', licensePlate: 'TRK-001' },
        },
      ]);
      mockPrisma.maintenanceRecord.findFirst.mockResolvedValueOnce(null);
      mockPrisma.dailyFuelReport.aggregate.mockResolvedValueOnce({ _sum: { distanceKm: 5100 } });
      mockPrisma.notification.findFirst.mockResolvedValueOnce({ id: 'notif-existing' });

      await service.checkDueMaintenances();

      expect(mockNotifications.create).not.toHaveBeenCalled();
    });

    it("continue sur l'entreprise suivante si une entreprise échoue", async () => {
      mockPrisma.company.findMany.mockResolvedValueOnce([{ id: 'comp-fail' }, { id: 'comp-ok' }]);
      mockPrisma.vehicleMaintenanceSchedule.findMany
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce([]);

      await expect(service.checkDueMaintenances()).resolves.toBeUndefined();
      expect(mockPrisma.vehicleMaintenanceSchedule.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
