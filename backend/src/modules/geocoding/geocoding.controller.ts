import { Controller, Get, Query } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';
import { Public } from '../../common/decorators/public.decorator';
import { SkipCsrf } from '../../common/decorators/skip-csrf.decorator';
import type { GeocodingResult } from './geocoding.service';

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
