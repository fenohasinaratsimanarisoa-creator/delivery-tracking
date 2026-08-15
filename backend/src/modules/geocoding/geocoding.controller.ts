import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { GeocodingService } from './geocoding.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import type { GeocodingResult } from './geocoding.service';

// Throttle STRICT : ce controller est public et fait office de proxy vers des API
// externes coûteuses/limitées — Google Places (facturé par requête, GOOGLE_MAPS_API_KEY)
// et Nominatim OSM (usage policy : max 1 req/s, bannissement d'IP sinon). Le throttle
// global (100 req/min par IP) laissait un attaquant épuiser le budget Google Places ou
// faire bannir l'IP serveur par OSM (→ tout le geocoding de l'app tombait). Un utilisateur
// légitime tape quelques adresses par minute, 20 req/min par IP est amplement suffisant.
@Throttle({ default: { limit: 20, ttl: 60000 } })
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
}
