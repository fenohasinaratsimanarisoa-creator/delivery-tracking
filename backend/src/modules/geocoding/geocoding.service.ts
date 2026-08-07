import { Injectable, Inject, Logger } from '@nestjs/common';
import { REDIS_CLIENT } from '../../common/redis/redis.module';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

interface GeocodingResult {
  lat: number;
  lng: number;
  label: string;
  displayName: string;
}

export type { GeocodingResult };

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'DeliveryTrack/1.0 (logistics)';
const CACHE_TTL_SEC = 86400; // 24h
const MG_VIEWBOX = '43,11,51,-26';

function extractLocalLabel(item: any): string {
  const addr = item.address || {};
  const name = item.name || '';
  const road = addr.road || addr.street || addr.highway || '';
  const houseNum = addr.house_number || '';
  const suburb =
    addr.suburb || addr.neighbourhood || addr.quarter || addr.hamlet || addr.village || '';
  const city = addr.city || addr.town || addr.municipality || addr.county || '';
  const district = addr.state_district || addr.region || '';
  const fallback = item.display_name?.split(',')[0] || '';

  const parts = [
    road ? `${houseNum ? houseNum + ' ' : ''}${road}` : name || fallback,
    suburb,
    city || district,
  ].filter(Boolean);
  const seen = new Set<string>();
  return parts
    .filter((p) => {
      const lower = p.toLowerCase().trim();
      if (seen.has(lower)) return false;
      seen.add(lower);
      return true;
    })
    .slice(0, 4)
    .join(' — ');
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly googleApiKey: string | undefined;

  constructor(
    @Inject(REDIS_CLIENT) private redis: Redis | null,
    private configService: ConfigService,
  ) {
    this.googleApiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
  }

  async placesAutocomplete(
    input: string,
  ): Promise<{ placeId: string; description: string; mainText: string; secondaryText: string }[]> {
    if (!input.trim() || !this.googleApiKey) return [];

    const cacheKey = `places:autocomplete:${input.toLowerCase().trim()}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const body = {
      input,
      includedRegionCodes: ['MG'],
      languageCode: 'fr',
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.googleApiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '(no body)');
        this.logger.error(
          `Google Places API HTTP ${res.status} for input="${input}": ${errorBody.slice(0, 2000)}`,
        );
        return [];
      }
      const data: any = await res.json();
      if (!data.suggestions) {
        this.logger.warn(
          `Google Places API returned no suggestions for input="${input}": ${JSON.stringify(data).slice(0, 1000)}`,
        );
        return [];
      }

      const results = data.suggestions.slice(0, 8).map((s: any) => ({
        placeId: s.placePrediction?.placeId || s.placePrediction?.place_id || '',
        description: s.placePrediction?.text?.text || s.placePrediction?.description || '',
        mainText: s.placePrediction?.structuredFormat?.mainText?.text || '',
        secondaryText: s.placePrediction?.structuredFormat?.secondaryText?.text || '',
      }));

      if (this.redis && results.length > 0) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(results), 'EX', CACHE_TTL_SEC);
        } catch {}
      }

      return results;
    } catch (err: unknown) {
      this.logger.error(
        `Google Places API fetch/parse error for input="${input}": ${(err as Error).message}`,
      );
      return [];
    }
  }

  async placeDetails(
    placeId: string,
  ): Promise<{ lat: number; lng: number; address: string; name: string } | null> {
    if (!this.googleApiKey) return null;

    const cacheKey = `places:details:${placeId}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(
        `https://places.googleapis.com/v1/places/${placeId}?fields=location,formattedAddress,displayName&languageCode=fr`,
        {
          headers: { 'X-Goog-Api-Key': this.googleApiKey },
          signal: controller.signal,
        },
      );
      clearTimeout(timeout);

      if (!res.ok) {
        const errorBody = await res.text().catch(() => '(no body)');
        this.logger.error(
          `Google Places Details API HTTP ${res.status} for placeId="${placeId}": ${errorBody.slice(0, 2000)}`,
        );
        return null;
      }
      const data: any = await res.json();
      if (!data?.location) {
        this.logger.warn(
          `Google Places Details API no location for placeId="${placeId}": ${JSON.stringify(data).slice(0, 1000)}`,
        );
        return null;
      }

      const result = {
        lat: data.location.latitude,
        lng: data.location.longitude,
        address: data.formattedAddress || '',
        name: data.displayName?.text || '',
      };

      if (this.redis) {
        try {
          await this.redis.set(cacheKey, JSON.stringify(result), 'EX', 2592000);
        } catch {}
      }

      return result;
    } catch (err: unknown) {
      this.logger.error(
        `Google Places Details API fetch/parse error for placeId="${placeId}": ${(err as Error).message}`,
      );
      return null;
    }
  }

  async search(query: string): Promise<GeocodingResult[]> {
    if (!query.trim()) return [];

    const cacheKey = `geocode:search:${query.toLowerCase().trim()}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const results: GeocodingResult[] = [];
    const seen = new Set<string>();

    const queries = [query];
    if (!query.includes('Madagascar') && !query.includes('Madagasikara')) {
      queries.push(`${query}, Madagascar`);
    }
    const words = query.split(/\s+/);
    if (words.length >= 3) {
      queries.push(words.slice(0, 2).join(' '));
    }

    for (const q of queries) {
      const params = new URLSearchParams({
        q,
        format: 'json',
        limit: '20',
        'accept-language': 'fr',
        addressdetails: '1',
        namedetails: '1',
      });
      if (results.length < 3) {
        params.set('viewbox', MG_VIEWBOX);
      }

      const url = `${NOMINATIM_BASE}/search?${params}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data: any[] = await res.json();
          for (const item of data) {
            const key = `${parseFloat(item.lat).toFixed(4)},${parseFloat(item.lon).toFixed(4)}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                label: extractLocalLabel(item),
                displayName: item.display_name,
              });
            }
          }
        }
      } catch (err: unknown) {
        clearTimeout(timeout);
        this.logger.warn(`Nominatim search failed for query="${q}": ${(err as Error).message}`);
      }

      if (results.length >= 10) break;
    }

    if (results.length === 0 && query.length > 3) {
      const fallbackQueries = [
        query.split(',').pop()?.trim() || query,
        query.replace(/\b(Lot|N°|No|Bis|Ter|Bât)\s*\w*\s*/gi, '').trim(),
      ];
      const firstWord = query.split(/\s+/)[0];
      if (firstWord && firstWord !== query) {
        fallbackQueries.push(firstWord);
      }
      for (const fq of [...new Set(fallbackQueries)]) {
        if (!fq) continue;
        const params = new URLSearchParams({
          q: fq,
          format: 'json',
          limit: '10',
          'accept-language': 'fr',
          addressdetails: '1',
          namedetails: '1',
        });
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 6000);
          const res = await fetch(`${NOMINATIM_BASE}/search?${params}`, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) {
            const data: any[] = await res.json();
            for (const item of data) {
              const key = `${parseFloat(item.lat).toFixed(4)},${parseFloat(item.lon).toFixed(4)}`;
              if (!seen.has(key)) {
                seen.add(key);
                results.push({
                  lat: parseFloat(item.lat),
                  lng: parseFloat(item.lon),
                  label: extractLocalLabel(item),
                  displayName: item.display_name,
                });
              }
            }
          }
        } catch {
          /* continue */
        }
        if (results.length >= 5) break;
      }
    }

    const final = results.slice(0, 20);
    if (this.redis && final.length > 0) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(final), 'EX', CACHE_TTL_SEC);
      } catch {}
    }

    return final;
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const cacheKey = `geocode:reverse:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
      } catch {}
    }

    const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr&addressdetails=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) return null;
      const data: any = await res.json();
      const result = data?.display_name || null;

      if (this.redis && result) {
        try {
          await this.redis.set(cacheKey, result, 'EX', CACHE_TTL_SEC);
        } catch {}
      }

      return result;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  async nearby(lat: number, lng: number): Promise<GeocodingResult[]> {
    const cacheKey = `geocode:nearby:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch {}
    }

    const areaName = await this.reverse(lat, lng);
    const baseQuery = areaName?.split(',')[0]?.trim() || '';
    const viewbox = `${lng - 0.15},${lat - 0.1},${lng + 0.15},${lat + 0.1}`;

    const results: GeocodingResult[] = [];
    const seen = new Set<string>();

    const queries = baseQuery
      ? [
          { q: baseQuery, limit: '10' },
          { q: `${baseQuery} rue`, limit: '6' },
          { q: baseQuery.split(' ')[0] || baseQuery, limit: '8' },
        ]
      : [
          { q: 'Antananarivo', limit: '10' },
          { q: 'Antananarivo rue', limit: '6' },
        ];

    for (const { q, limit } of queries) {
      const params = new URLSearchParams({
        q,
        format: 'json',
        limit,
        'accept-language': 'fr',
        countrycodes: 'mg',
        viewbox,
        addressdetails: '1',
      });

      const url = `${NOMINATIM_BASE}/search?${params}`;

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data: any[] = await res.json();
          for (const item of data) {
            const key = `${parseFloat(item.lat).toFixed(4)},${parseFloat(item.lon).toFixed(4)}`;
            if (!seen.has(key)) {
              seen.add(key);
              results.push({
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                label: extractLocalLabel(item),
                displayName: item.display_name,
              });
            }
          }
        }
      } catch {
        /* continue */
      }

      if (results.length >= 20) break;
    }

    const final = results.slice(0, 25);
    if (this.redis && final.length > 0) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(final), 'EX', 3600);
      } catch {}
    }

    return final;
  }
}
