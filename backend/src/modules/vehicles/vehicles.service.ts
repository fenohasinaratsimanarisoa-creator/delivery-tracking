import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
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

  private async checkTraccarDeviceIdUniqueness(
    traccarDeviceId: string,
    excludeId?: string,
  ) {
    const existing = await this.prisma.vehicle.findFirst({
      where: {
        traccarDeviceId,
        isActive: true,
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing) {
      throw new ConflictException(
        `traccarDeviceId "${traccarDeviceId}" is already assigned to another active vehicle`,
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
          driver: { select: { id: true, firstName: true, lastName: true } },
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

    return this.prisma.vehicle.update({
      where: { id },
      data: { deletedAt: new Date() },
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

    const response = await fetch(`${traccarUrl}/api/devices`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        name,
        uniqueId,
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

      const alreadyLinkedDeviceIds = new Set<string>();
      const linked = await this.prisma.vehicle.findMany({
        where: {
          traccarDeviceId: { not: null },
          isActive: true,
          deletedAt: null,
        },
        select: { traccarDeviceId: true },
      });
      for (const v of linked) {
        if (v.traccarDeviceId) alreadyLinkedDeviceIds.add(v.traccarDeviceId);
      }

      return devices
        .filter((d) => !alreadyLinkedDeviceIds.has(String(d.id)))
        .map((d) => ({
          id: d.id,
          name: d.name,
          uniqueId: d.uniqueId,
        }));
    } catch (err: any) {
      throw new BadRequestException(
        `Traccar is unavailable: ${err.message}`,
      );
    }
  }

  private async authenticateTraccar(
    url: string,
    user: string,
    password: string,
  ): Promise<string> {
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
