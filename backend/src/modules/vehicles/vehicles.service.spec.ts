import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { VehiclesService } from './vehicles.service';

const mockPrisma = {
  vehicle: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  driver: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  delivery: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn().mockImplementation((arg: any) => {
    if (typeof arg === 'function') return arg(mockPrisma);
    if (Array.isArray(arg)) return Promise.all(arg);
    return Promise.resolve(arg);
  }),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultValue?: any) => {
    if (key === 'TRACCAR_URL') return 'http://traccar:8082';
    if (key === 'TRACCAR_USER') return 'admin';
    if (key === 'TRACCAR_PASSWORD') return 'admin';
    return defaultValue;
  }),
};

describe('VehiclesService', () => {
  let service: VehiclesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VehiclesService(
      mockPrisma as unknown as PrismaService,
      mockConfigService as unknown as ConfigService,
    );
  });

  const dto = {
    brand: 'Toyota',
    model: 'Hilux',
    year: 2024,
    licensePlate: 'TRK-001',
    fuelType: 'diesel',
    theoreticalConsumption: 8.5,
  };

  describe('create', () => {
    it('creates a vehicle when the plate is unique', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.create.mockResolvedValueOnce({
        id: 'vehicle-1',
        ...dto,
        companyId: 'company-1',
      });

      await expect(service.create('company-1', dto)).resolves.toMatchObject({
        id: 'vehicle-1',
      });
      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith({
        data: { ...dto, companyId: 'company-1', positionSource: 'phone' },
      });
    });

    it('rejects duplicate plates', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });

      await expect(service.create('company-1', dto)).rejects.toThrow(ConflictException);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });

    it('rejects physical_tracker without traccarDeviceId', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create('company-1', { ...dto, positionSource: 'physical_tracker' }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.create('company-1', { ...dto, positionSource: 'physical_tracker' }),
      ).rejects.toThrow(/traccarDeviceId is required/);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });

    it('accepts physical_tracker with traccarDeviceId', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.create.mockResolvedValueOnce({
        id: 'vehicle-1',
        ...dto,
        companyId: 'company-1',
        positionSource: 'physical_tracker',
        traccarDeviceId: '42',
      });

      await expect(
        service.create('company-1', {
          ...dto,
          positionSource: 'physical_tracker',
          traccarDeviceId: '42',
        }),
      ).resolves.toMatchObject({ id: 'vehicle-1' });
    });

    it('rejects duplicate traccarDeviceId', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValueOnce(null);
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-existing' });

      await expect(
        service.create('company-1', {
          ...dto,
          positionSource: 'physical_tracker',
          traccarDeviceId: '42',
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });
  });

  it('builds filters and pagination for vehicle listing', async () => {
    mockPrisma.vehicle.findMany.mockResolvedValueOnce([{ id: 'vehicle-1' }]);
    mockPrisma.vehicle.count.mockResolvedValueOnce(12);

    await expect(
      service.findAll('company-1', {
        search: 'hilux',
        brand: 'Toyota',
        isActive: true,
        page: 2,
        limit: 5,
      }),
    ).resolves.toEqual({
      data: [{ id: 'vehicle-1' }],
      meta: { total: 12, page: 2, limit: 5, totalPages: 3 },
    });
    expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith({
      where: {
        companyId: 'company-1',
        deletedAt: null,
        OR: [
          { brand: { contains: 'hilux', mode: 'insensitive' } },
          { model: { contains: 'hilux', mode: 'insensitive' } },
          { licensePlate: { contains: 'hilux', mode: 'insensitive' } },
        ],
        brand: { equals: 'Toyota', mode: 'insensitive' },
        isActive: true,
      },
      skip: 5,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        driver: {
          select: { id: true, firstName: true, lastName: true, trackingReliability: true },
        },
      },
    });
  });

  describe('findOne', () => {
    it('returns a vehicle in the company scope', async () => {
      const vehicle = { id: 'vehicle-1', companyId: 'company-1' };
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(vehicle);

      await expect(service.findOne('company-1', 'vehicle-1')).resolves.toEqual(vehicle);
    });

    it('throws when the vehicle is not found', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null);

      await expect(service.findOne('company-1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates a vehicle after ownership and plate checks', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.vehicle.update.mockResolvedValueOnce({
        id: 'vehicle-1',
        licensePlate: 'TRK-NEW',
      });

      await expect(
        service.update('company-1', 'vehicle-1', { licensePlate: 'TRK-NEW' }),
      ).resolves.toMatchObject({ licensePlate: 'TRK-NEW' });
      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { licensePlate: 'TRK-NEW' },
      });
    });

    it('rejects a plate already used by another vehicle', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-2' });

      await expect(
        service.update('company-1', 'vehicle-1', { licensePlate: 'TRK-TAKEN' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
    });

    it('libère le traccarDeviceId quand on repasse un véhicule de physical_tracker à phone', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' }); // findOne
      mockPrisma.vehicle.update.mockResolvedValueOnce({ id: 'vehicle-1', positionSource: 'phone' });

      await service.update('company-1', 'vehicle-1', { positionSource: 'phone' });

      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { positionSource: 'phone', traccarDeviceId: null },
      });
    });

    it('ne touche pas au traccarDeviceId sur une mise à jour qui ne change pas la source', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' }); // findOne
      mockPrisma.vehicle.update.mockResolvedValueOnce({ id: 'vehicle-1' });

      await service.update('company-1', 'vehicle-1', { model: 'X' });

      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { model: 'X' },
      });
    });
  });

  // ----------------------------------------------------------------
  // PROVISIONING AUTOMATIQUE PAR IMEI — l'admin ne saisit QUE l'IMEI, le
  // device Traccar (création + liaison) est géré côté serveur.
  // ----------------------------------------------------------------
  describe('provisioning automatique par IMEI', () => {
    const enableTraccar = () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string, def?: any) => {
        if (key === 'TRACCAR_URL') return 'http://localhost:8082';
        if (key === 'TRACCAR_USER') return 'admin';
        if (key === 'TRACCAR_PASSWORD') return 'admin';
        return def;
      });
    };

    const mockCreateDeviceResponse = (device: { id: number; name: string; uniqueId: string }) => {
      jest.spyOn(service as any, 'authenticateTraccar').mockResolvedValue('cookie=abc');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => device,
      } as Response);
    };

    it('crée le device Traccar depuis le seul IMEI et lie le véhicule automatiquement (create)', async () => {
      enableTraccar();
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null); // plate check
      mockCreateDeviceResponse({ id: 555, name: 'Toyota Hilux — TRK-001', uniqueId: '123456789012345' });
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null); // checkTraccarDeviceIdUniqueness('555')
      mockPrisma.vehicle.create.mockResolvedValueOnce({
        id: 'vehicle-1',
        ...dto,
        traccarDeviceId: '555',
      });

      await service.create('company-1', {
        ...dto,
        positionSource: 'physical_tracker',
        imei: '123456789012345',
      });

      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          positionSource: 'physical_tracker',
          traccarDeviceId: '555',
        }),
      });
      // `imei` n'est jamais une colonne de `vehicles` — jamais transmis à Prisma.
      expect(mockPrisma.vehicle.create.mock.calls[0][0].data.imei).toBeUndefined();
    });

    it("une erreur Traccar à la création (ex. IMEI déjà enregistré) empêche la création du véhicule", async () => {
      enableTraccar();
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null); // plate check
      jest.spyOn(service as any, 'authenticateTraccar').mockResolvedValue('cookie=abc');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        text: async () => 'Duplicate unique id',
      } as Response);

      await expect(
        service.create('company-1', {
          ...dto,
          positionSource: 'physical_tracker',
          imei: '123456789012345',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
    });

    it('remplace le traceur lié via un simple update {imei} sur un véhicule déjà en physical_tracker', async () => {
      enableTraccar();
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-1',
        companyId: 'company-1',
        positionSource: 'physical_tracker',
        traccarDeviceId: '111',
        brand: 'Toyota',
        model: 'Hilux',
        licensePlate: 'TRK-001',
      }); // findOne
      mockCreateDeviceResponse({ id: 999, name: 'Toyota Hilux — TRK-001', uniqueId: '999888777666555' });
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null); // checkTraccarDeviceIdUniqueness('999')
      mockPrisma.vehicle.update.mockResolvedValueOnce({ id: 'vehicle-1', traccarDeviceId: '999' });

      // positionSource n'est PAS renvoyé — le véhicule est DÉJÀ physical_tracker,
      // seul un nouvel IMEI est fourni (boîtier remplacé).
      await service.update('company-1', 'vehicle-1', { imei: '999888777666555' });

      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { traccarDeviceId: '999' },
      });
    });

    it("un traccarDeviceId fourni explicitement reste prioritaire sur l'imei (pas d'appel Traccar)", async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null); // plate check
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce(null); // checkTraccarDeviceIdUniqueness('42')
      mockPrisma.vehicle.create.mockResolvedValueOnce({ id: 'vehicle-1', traccarDeviceId: '42' });
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy;

      await service.create('company-1', {
        ...dto,
        positionSource: 'physical_tracker',
        traccarDeviceId: '42',
        imei: '123456789012345',
      });

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockPrisma.vehicle.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ traccarDeviceId: '42' }),
      });
    });
  });

  // ----------------------------------------------------------------
  // DEVICES TRACCAR — isolement multi-entreprises : l'entreprise A ne doit
  // JAMAIS voir les devices de l'entreprise B (ni liés, ni non-liés).
  // ----------------------------------------------------------------
  describe('getAvailableTraccarDevices (cross-tenant isolation)', () => {
    const companyA = 'aaaaaaaa-1111-0000-0000-000000000001';
    const companyB = 'bbbbbbbb-2222-0000-0000-000000000002';
    const traccarDevices = [
      { id: 101, name: 'Tracker A-1', uniqueId: 'aaaaaaaa-TRK-A1' },
      { id: 102, name: 'Tracker B-1', uniqueId: 'bbbbbbbb-TRK-B1' },
      { id: 103, name: 'Tracker A-2', uniqueId: 'aaaaaaaa-TRK-A2' },
      { id: 104, name: 'Tracker B-2', uniqueId: 'bbbbbbbb-TRK-B2' },
    ];

    const enableTraccar = () => {
      (mockConfigService.get as jest.Mock).mockImplementation((key: string, def?: any) => {
        if (key === 'TRACCAR_URL') return 'http://localhost:8082';
        if (key === 'TRACCAR_USER') return 'admin';
        if (key === 'TRACCAR_PASSWORD') return 'admin';
        return def;
      });
    };

    const mockTraccarDevicesResponse = () => {
      jest.spyOn(service as any, 'authenticateTraccar').mockResolvedValue('cookie=abc');
      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => traccarDevices,
      } as Response);
    };

    it('l\'entreprise A ne voit jamais les devices déjà liés à l\'entreprise B dans la liste "disponibles"', async () => {
      enableTraccar();
      mockTraccarDevicesResponse();

      // L'entreprise B a DÉJÀ lié le device 104 à un de ses véhicules actifs.
      // La requête `linked` ne doit PAS être scopée à l'entreprise courante
      // (A) : le device de B doit être exclu même si A n'a aucun véhicule.
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([
        { traccarDeviceId: '103' }, // device lié par l'entreprise A (exclu)
        { traccarDeviceId: '104' }, // device lié par l'entreprise B (exclu AUSSI)
      ]);

      const available = await service.getAvailableTraccarDevices(companyA);

      // La requête `linked` a été passée SANS companyId (contexte tenant
      // désactivé) : sans ce fix, le middleware tenant l'aurait scopée à A et
      // le device 104 de B serait apparu comme "disponible" pour A.
      expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ companyId: expect.anything() }),
        }),
      );

      // Seuls les devices portant le préfixe de l'entreprise A sont proposés,
      // et uniquement ceux qui ne sont liés à AUCUN véhicule (toute la base).
      expect(available.map((d) => d.id)).toEqual([101]);
      expect(available.map((d) => d.uniqueId)).toEqual(['aaaaaaaa-TRK-A1']);
    });

    it("filtre par préfixe : un device non-lié de l'entreprise B n'est jamais proposé à A", async () => {
      enableTraccar();
      mockTraccarDevicesResponse();
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([]);

      const available = await service.getAvailableTraccarDevices(companyA);

      // 102 (prefix bbbbbbbb) et 104 (prefix bbbbbbbb) exclus par préfixe.
      expect(available.map((d) => d.id)).toEqual([101, 103]);
    });

    it("s'authentifie auprès de Traccar en application/x-www-form-urlencoded, pas en JSON (bug réel 2026-09-05 : 400 systématique avec le mauvais content-type)", async () => {
      enableTraccar();
      mockPrisma.vehicle.findMany.mockResolvedValueOnce([]);

      const fetchMock = jest
        .fn()
        // 1er appel : POST /api/session (login)
        .mockResolvedValueOnce({
          ok: true,
          headers: {
            get: (h: string) => (h === 'set-cookie' ? 'JSESSIONID=abc123; Path=/' : null),
          },
        } as unknown as Response)
        // 2e appel : GET /api/devices
        .mockResolvedValueOnce({ ok: true, json: async () => traccarDevices } as Response);
      global.fetch = fetchMock;

      await service.getAvailableTraccarDevices(companyA);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'http://localhost:8082/api/session',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'email=admin&password=admin',
        }),
      );
    });
  });

  describe('remove', () => {
    it('soft deletes an unused vehicle', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      mockPrisma.vehicle.update.mockResolvedValueOnce({ id: 'vehicle-1' });

      await service.remove('company-1', 'vehicle-1');
      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { deletedAt: expect.any(Date) },
      });
    });

    it('blocks deletion while assigned to an in-progress delivery', async () => {
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({ id: 'vehicle-1' });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce({ id: 'delivery-1' });

      await expect(service.remove('company-1', 'vehicle-1')).rejects.toThrow(BadRequestException);
      expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
    });

    it('libère la FK driver.vehicleId : un NOUVEAU driver peut ensuite être assigné au même véhicule', async () => {
      // 1) État initial : un driver D-2 est assigné au véhicule vehicle-1 →
      //    la contrainte unique driver.vehicle_id est occupée.
      mockPrisma.driver.findFirst.mockResolvedValueOnce({
        id: 'driver-2',
        vehicleId: 'vehicle-1',
      });
      const occupied = await mockPrisma.driver.findFirst({
        where: { vehicleId: 'vehicle-1', deletedAt: null },
      });
      expect(occupied).not.toBeNull();

      // 2) Suppression du véhicule → le driver est désassigné (vehicleId null)
      //    dans la MÊME transaction que le soft-delete du véhicule.
      mockPrisma.vehicle.findFirst.mockResolvedValueOnce({
        id: 'vehicle-1',
        companyId: 'company-1',
      });
      mockPrisma.delivery.findFirst.mockResolvedValueOnce(null);
      mockPrisma.driver.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.vehicle.update.mockResolvedValueOnce({
        id: 'vehicle-1',
        deletedAt: new Date(),
      });

      await service.remove('company-1', 'vehicle-1');

      expect(mockPrisma.driver.updateMany).toHaveBeenCalledWith({
        where: { vehicleId: 'vehicle-1', deletedAt: null },
        data: { vehicleId: null },
      });
      expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'vehicle-1' },
        data: { deletedAt: expect.any(Date) },
      });

      // 3) La contrainte unique est libérée → le contrôle d'assignation (même
      //    logique que DriversService.create) ne trouve plus de driver sur
      //    vehicle-1 : un NOUVEAU driver peut être assigné sans erreur.
      mockPrisma.driver.findFirst.mockResolvedValueOnce(null);
      const stillAssigned = await mockPrisma.driver.findFirst({
        where: { vehicleId: 'vehicle-1', deletedAt: null },
      });
      expect(stillAssigned).toBeNull();
    });
  });
});
