import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GeocodingService } from './geocoding.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import type { GeocodingResult } from './geocoding.service';

// Throttle de ce controller public, proxy vers des API externes coûteuses/limitées —
// Google Places (facturé par requête, GOOGLE_MAPS_API_KEY) et Nominatim OSM (max 1 req/s,
// bannissement d'IP sinon). Deux garde-fous rendent un plafond HTTP serré INUTILE et
// même nuisible :
//   • Nominatim : GeocodingService sérialise TOUS les appels sortants dans une file
//     unique au niveau du process (1 requête / 1,1 s), quel que soit le débit HTTP entrant.
//   • Google Places : réponses cachées 24 h en Redis + quota/alertes budget côté Google.
// L'ancien plafond de 20 req/min était en revanche atteint par l'usage NORMAL :
// l'autocomplétion d'adresse déclenche 2 requêtes par frappe débouncée
// (/places/autocomplete + /search), sur 2 champs (enlèvement + livraison). Saisir
// deux adresses réelles dépassait 20 → 429 → les DEUX fournisseurs renvoyaient vide
// côté front → il ne restait que la liste hors-ligne des communes (« grandes villes »),
// bug remonté en prod. 100 req/min couvre la saisie de plusieurs livraisons par minute
// tout en bloquant un scraping.
@Throttle({ default: { limit: 100, ttl: 60000 } })
@Controller('geocoding')
@Public()
@SkipCsrf()
export class GeocodingController {
  constructor(private readonly geocodingService: GeocodingService) {}

  @Get('search')
  async search(@Query('q') q: string): Promise<GeocodingResult[]> {
    return this.geocodingService.search(q);
  }

  @Get('reverse')
  async reverse(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ): Promise<{ label: string | null }> {
    const result = await this.geocodingService.reverse(parseFloat(lat), parseFloat(lng));
    return { label: result };
  }

  @Get('nearby')
  async nearby(@Query('lat') lat: string, @Query('lng') lng: string): Promise<GeocodingResult[]> {
    return this.geocodingService.nearby(parseFloat(lat), parseFloat(lng));
  }

  @Get('places/autocomplete')
  async placesAutocomplete(@Query('input') input: string) {
    return this.geocodingService.placesAutocomplete(input);
  }

  @Get('places/details')
  async placeDetails(@Query('placeid') placeid: string) {
    return this.geocodingService.placeDetails(placeid);
  }

  @Get('health')
  async health() {
    return this.geocodingService.getHealthStatus();
  }
}
