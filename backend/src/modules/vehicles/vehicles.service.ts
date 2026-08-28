import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CompanyScopedContext } from '../../common/tenant/company-scoped-context';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleFilterDto } from './dto/vehicle-filter.dto';

@Injectable()
export class VehiclesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  private validateTrackerConfig(dto: CreateVehicleDto | UpdateVehicleDto) {
    const posSource = dto.positionSource ?? 'phone';
    if (posSource === 'physical_tracker' && !dto.traccarDeviceId) {
      throw new BadRequestException(
        'traccarDeviceId is required when positionSource is physical_tracker',
      );
    }
  }

  private async checkTraccarDeviceIdUniqueness(traccarDeviceId: string, excludeId?: string) {
    // On vérifie TOUS les états (actif/inactif/soft-deleted), pas seulement les
    // véhicules actifs : un `traccarDeviceId` est GLOBALEMENT unique en base
    // (contrainte @unique) — laisser passer ici un doublon inactif produisait un
    // P2002 → 500 au lieu d'un 409 explicite. Le `where` n'est PAS scopé par
    // companyId : c'est volontaire, la collision peut venir d'un autre tenant.
    //
    // LIMITE CONNUE (non corrigée ici — nécessite une preuve de possession) : un
    // traceur qu'AUCUNE entreprise n'a encore lié peut être revendiqué par
    // n'importe quel tenant qui en connaît l'ID → il capterait alors le flux GPS
    // du traceur physique d'un tiers. Cf. AUDIT_APPROFONDI_2026-08-28.
    const existing = await CompanyScopedContext.run(null, () =>
      this.prisma.vehicle.findFirst({
        where: {
          traccarDeviceId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      }),
    );
    if (existing) {
      throw new ConflictException(
        `traccarDeviceId "${traccarDeviceId}" is already assigned to another vehicle`,
      );
    }
  }

  async create(companyId: string, dto: CreateVehicleDto) {
    const existing = await this.prisma.vehicle.findFirst({
      where: { companyId, licensePlate: dto.licensePlate, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('License plate already exists');
    }

    this.validateTrackerConfig(dto);
    if (dto.traccarDeviceId) {
      await this.checkTraccarDeviceIdUniqueness(dto.traccarDeviceId);
    }

    const data: any = { ...dto, companyId };
    if (!dto.positionSource) {
      data.positionSource = 'phone';
    }

    return this.prisma.vehicle.create({ data });
  }

  async findAll(companyId: string, filter: VehicleFilterDto) {
    const where: any = { companyId, deletedAt: null };

    if (filter.search) {
      where.OR = [
        { brand: { contains: filter.search, mode: 'insensitive' } },
        { model: { contains: filter.search, mode: 'insensitive' } },
        { licensePlate: { contains: filter.search, mode: 'insensitive' } },
      ];
    }
    if (filter.brand) {
      where.brand = { equals: filter.brand, mode: 'insensitive' };
    }
    if (filter.isActive !== undefined) {
      where.isActive = filter.isActive;
    }

    const page = filter.page || 1;
    const limit = filter.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          driver: {
            select: { id: true, firstName: true, lastName: true, trackingReliability: true },
          },
        },
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findAllSimple(companyId: string) {
    return this.prisma.vehicle.findMany({
      where: { companyId, deletedAt: null, isActive: true },
      orderBy: { brand: 'asc' },
      select: {
        id: true,
        brand: true,
        model: true,
        licensePlate: true,
        fuelType: true,
        positionSource: true,
        traccarDeviceId: true,
        driver: { select: { id: true } },
      },
    });
  }

  async findOne(companyId: string, id: string) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, companyId, deletedAt: null },
    });
    if (!vehicle) throw new NotFoundException('Vehicle not found');
    return vehicle;
  }

  async update(companyId: string, id: string, dto: UpdateVehicleDto) {
    await this.findOne(companyId, id);

    if (dto.licensePlate) {
      const existing = await this.prisma.vehicle.findFirst({
        where: { companyId, licensePlate: dto.licensePlate, deletedAt: null },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException('License plate already in use');
      }
    }

    this.validateTrackerConfig(dto);
    if (dto.traccarDeviceId) {
      await this.checkTraccarDeviceIdUniqueness(dto.traccarDeviceId, id);
    }

    return this.prisma.vehicle.update({
      where: { id },
      data: dto,
    });
  }

  async remove(companyId: string, id: string) {
    await this.findOne(companyId, id);

    const inProgress = await this.prisma.delivery.findFirst({
      where: { vehicleId: id, status: 'in_progress', deletedAt: null },
    });
    if (inProgress) {
      throw new BadRequestException('Cannot delete vehicle assigned to an in-progress delivery');
    }

    // Désassigne les drivers qui pointent vers ce véhicule dans la MÊME
    // transaction que le soft-delete : un driver gardant vehicleId empêcherait
    // la réassignation de ce véhicule (index unique driver.vehicle_id).
    return this.prisma.$transaction(async (tx) => {
      await tx.driver.updateMany({
        where: { vehicleId: id, deletedAt: null },
        data: { vehicleId: null },
      });
      return tx.vehicle.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    });
  }

  async createTraccarDevice(name: string, uniqueId: string) {
    const traccarUrl = this.configService.get<string>('TRACCAR_URL', 'http://traccar:8082');

    if (traccarUrl === 'http://traccar:8082' || traccarUrl === 'disabled') {
      throw new BadRequestException('Traccar is not configured');
    }

    const cookie = await this.authenticateTraccar(
      traccarUrl,
      this.configService.get<string>('TRACCAR_USER', 'admin')!,
      this.configService.get<string>('TRACCAR_PASSWORD', 'admin')!,
    );

    // Préfixe unique par entreprise dans l'identifiant Traccar : les devices
    // d'une entreprise ne sont jamais exposés comme "disponibles" à une autre.
    const companyId = CompanyScopedContext.get();
    const scopedUniqueId = companyId ? `${companyId.slice(0, 8)}-${uniqueId}` : uniqueId;

    const response = await fetch(`${traccarUrl}/api/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        name,
        uniqueId: scopedUniqueId,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new BadRequestException(`Traccar device creation failed: ${body}`);
    }

    const device = await response.json();
    return { id: device.id, name: device.name, uniqueId: device.uniqueId };
  }

  async getAvailableTraccarDevices(companyId: string) {
    const traccarUrl = this.configService.get<string>('TRACCAR_URL', 'http://traccar:8082');
    const traccarUser = this.configService.get<string>('TRACCAR_USER', 'admin');
    const traccarPassword = this.configService.get<string>('TRACCAR_PASSWORD', 'admin');

    if (traccarUrl === 'http://traccar:8082' || traccarUrl === 'disabled') {
      throw new BadRequestException('Traccar is not configured');
    }

    try {
      const cookie = await this.authenticateTraccar(traccarUrl, traccarUser, traccarPassword);
      const response = await fetch(`${traccarUrl}/api/devices`, {
        headers: { Cookie: cookie },
      });
      if (!response.ok) {
        throw new Error(`Traccar API returned ${response.status}`);
      }
      const devices: Array<{ id: number; name: string; uniqueId: string }> = await response.json();

      // Filtre par entreprise : on ne garde que les devices dont le uniqueId
      // porte le préfixe de CETTE entreprise (defense en profondeur, même si un
      // device d'une autre entreprise n'a pas été lié à un véhicule).
      const prefix = companyId ? `${companyId.slice(0, 8)}-` : null;

      const alreadyLinkedDeviceIds = new Set<string>();
      // Contexte tenant DÉSACTIVÉ pour cette requête précise : un device déjà
      // lié par une AUTRE entreprise doit aussi être exclu de la liste, sinon il
      // reste proposé comme "disponible".
      const linked = await CompanyScopedContext.run(null, () =>
        this.prisma.vehicle.findMany({
          where: {
            traccarDeviceId: { not: null },
            isActive: true,
            deletedAt: null,
          },
          select: { traccarDeviceId: true },
        }),
      );
      for (const v of linked) {
        if (v.traccarDeviceId) alreadyLinkedDeviceIds.add(v.traccarDeviceId);
      }

      return devices
        .filter((d) => (prefix ? d.uniqueId.startsWith(prefix) : true))
        .filter((d) => !alreadyLinkedDeviceIds.has(String(d.id)))
        .map((d) => ({
          id: d.id,
          name: d.name,
          uniqueId: d.uniqueId,
        }));
    } catch (err: any) {
      throw new BadRequestException(`Traccar is unavailable: ${err.message}`);
    }
  }

  private async authenticateTraccar(url: string, user: string, password: string): Promise<string> {
    const loginResponse = await fetch(`${url}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user, password }),
    });

    if (!loginResponse.ok) {
      throw new Error(`Traccar authentication failed: ${loginResponse.status}`);
    }

    const setCookie = loginResponse.headers.get('set-cookie');
    if (!setCookie) {
      throw new Error('Traccar did not return a session cookie');
    }

    const match = setCookie.match(/JSESSIONID=([^;]+)/);
    if (!match) {
      throw new Error('Traccar session cookie (JSESSIONID) not found');
    }

    return `JSESSIONID=${match[1]}`;
  }
}
