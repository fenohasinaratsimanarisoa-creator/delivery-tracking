import { Controller, Get, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { MobileAppService } from './mobile-app.service';

/**
 * Endpoint PUBLIC (aucune auth) et rate-limité : consulté par le frontend web
 * (bannière d'installation) et par l'app mobile elle-même (détection de version
 * obsolète). Retourne la dernière release publiée par la CI, ou 404 si aucune
 * release n'a encore été buildée.
 */
@ApiTags('Mobile App')
@Controller('mobile-app')
export class MobileAppController {
  constructor(private readonly mobileAppService: MobileAppService) {}

  @Get('latest')
  // Rate limit strict : endpoint public consommé par des clients non authentifiés.
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Public()
  @ApiOperation({
    summary: "Dernière version de l'app mobile (APK)",
    description:
      "Public, rate-limité. Retourne la version actuelle, l'URL de téléchargement du dernier APK, le hash SHA-256, la date de build et le changelog. 404 si aucun build n'a encore été publié.",
  })
  async getLatest() {
    const release = await this.mobileAppService.getLatestRelease();
    if (!release) {
      throw new NotFoundException('No mobile app release published yet');
    }
    return release;
  }
}
