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
// Bbox Madagascar au format Nominatim <lon1>,<lat1>,<lon2>,<lat2>. Le pays est
// ENTIÈREMENT dans l'hémisphère sud (lat -11.9 à -25.6) : le « 11 » positif
// précédent décrivait une bbox à cheval sur l'équateur, remontant jusqu'au
// Somaliland — les résultats malgaches n'étaient donc pas priorisés.
const MG_VIEWBOX = '43,-11,51,-26';

// ── Observabilité Google Places / Nominatim (endpoint /geocoding/health) ───
// Sans ça, un échec Google Places (clé restreinte, billing désactivé, quota
// dépassé) n'était visible que dans les logs error/warn — invisible pour
// l'admin en prod. Redis si disponible (partagé entre toutes les instances
// du process, comme le reste du fichier), sinon repli en mémoire locale à
// l'instance (best-effort, comportement dégradé mais jamais bloquant).
const GOOGLE_FAILURES_ZSET = 'geocoding:google:failures';
const GOOGLE_LAST_ERROR_KEY = 'geocoding:google:lastError';
const GOOGLE_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h
const NOMINATIM_PING_CACHE_KEY = 'geocoding:nominatim:pingCache';
const NOMINATIM_PING_CACHE_TTL_MS = 60_000; // 60s — évite de spammer Nominatim à chaque /health

// ── Throttle process-wide des appels Nominatim ──────────────────────────────
// Politique d'usage Nominatim : max ~1 req/s par IP, sinon bannissement
// intermittent — qui se manifeste en prod par des réponses vides SILENCIEUSES
// (HTTP 200 avec []), donc une autocomplétion qui « ne trouve rien » sans la
// moindre erreur dans les logs. search() enchaîne jusqu'à 3 requêtes + 3 de
// repli, et nearby() jusqu'à 3, le tout sans espacement : le quota était
// dépassé dès la première frappe de l'utilisateur.
// Toutes les requêtes sortantes vers Nominatim (search, reverse, nearby) sont
// sérialisées dans une file unique au niveau du module (donc partagée par
// toutes les instances du service dans le process).
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let nominatimQueue: Promise<unknown> = Promise.resolve();
let nominatimLastDispatchAt = 0;

function throttleNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const waitMs = nominatimLastDispatchAt + NOMINATIM_MIN_INTERVAL_MS - Date.now();
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    // Horodaté au DÉPART de la requête (et non à son retour) : c'est l'espacement
    // entre départs que Nominatim mesure.
    nominatimLastDispatchAt = Date.now();
    return fn();
  };

  const result = nominatimQueue.then(run, run);
  // La file ne doit jamais rester « cassée » sur un rejet : on la ré-amorce sur
  // une promesse résolue, sinon tout appel ultérieur hériterait de l'échec.
  nominatimQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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

  // Repli mémoire (utilisé seulement si Redis est indisponible) pour le
  // suivi de santé Google Places / Nominatim — cf. constantes en tête de
  // fichier pour le pourquoi.
  private googleFailureTimestamps: number[] = [];
  private googleLastError: { message: string; at: number } | null = null;
  private nominatimPingCache: { reachable: boolean; at: number } | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private redis: Redis | null,
    private configService: ConfigService,
  ) {
    this.googleApiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
  }

  /** Enregistre un échec HTTP non-ok ou une erreur réseau Google Places (placesAutocomplete/placeDetails). */
  private async recordGooglePlacesFailure(message: string): Promise<void> {
    const now = Date.now();
    if (this.redis) {
      try {
        const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
        await this.redis.zadd(GOOGLE_FAILURES_ZSET, now, member);
        await this.redis.zremrangebyscore(GOOGLE_FAILURES_ZSET, 0, now - GOOGLE_FAILURE_WINDOW_MS);
        // TTL de sécurité largement au-delà de 24h : purge le zset si /health
        // n'est plus jamais interrogé (sinon il grossirait indéfiniment).
        await this.redis.expire(GOOGLE_FAILURES_ZSET, 3 * 24 * 60 * 60);
        await this.redis.set(GOOGLE_LAST_ERROR_KEY, JSON.stringify({ message, at: now }));
        return;
      } catch (err) {
        this.logger.debug(`Redis write failed for Google Places failure tracking: ${(err as Error).message}`);
      }
    }
    this.googleFailureTimestamps.push(now);
    this.googleLastError = { message, at: now };
  }

  /** Lit le nombre d'échecs Google Places sur les dernières 24h + le dernier message d'erreur. */
  private async getGoogleFailureStats(): Promise<{ count24h: number; lastError: string | null }> {
    const now = Date.now();
    if (this.redis) {
      try {
        await this.redis.zremrangebyscore(GOOGLE_FAILURES_ZSET, 0, now - GOOGLE_FAILURE_WINDOW_MS);
        const count = await this.redis.zcard(GOOGLE_FAILURES_ZSET);
        const raw = await this.redis.get(GOOGLE_LAST_ERROR_KEY);
        const lastError = raw ? (JSON.parse(raw) as { message: string }).message : null;
        return { count24h: count, lastError };
      } catch (err) {
        this.logger.debug(`Redis read failed for Google Places failure tracking: ${(err as Error).message}`);
      }
    }
    const cutoff = now - GOOGLE_FAILURE_WINDOW_MS;
    this.googleFailureTimestamps = this.googleFailureTimestamps.filter((t) => t >= cutoff);
    return { count24h: this.googleFailureTimestamps.length, lastError: this.googleLastError?.message ?? null };
  }

  /** Ping léger Nominatim (reverse geocode sur Antananarivo), caché 60s pour ne pas spammer le service. */
  private async checkNominatimReachable(): Promise<boolean> {
    const now = Date.now();
    if (this.redis) {
      try {
        const cached = await this.redis.get(NOMINATIM_PING_CACHE_KEY);
        if (cached !== null) return cached === '1';
      } catch (err) {
        this.logger.debug(`Redis read failed for Nominatim ping cache: ${(err as Error).message}`);
      }
    } else if (this.nominatimPingCache && now - this.nominatimPingCache.at < NOMINATIM_PING_CACHE_TTL_MS) {
      return this.nominatimPingCache.reachable;
    }

    let reachable = false;
    try {
      reachable = await throttleNominatim(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        try {
          const res = await fetch(
            `${NOMINATIM_BASE}/reverse?lat=-18.8792&lon=47.5079&format=json`,
            { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal },
          );
          return res.ok;
        } finally {
          clearTimeout(timeout);
        }
      });
    } catch (err) {
      this.logger.debug(`Nominatim health ping failed: ${(err as Error).message}`);
      reachable = false;
    }

    if (this.redis) {
      try {
        await this.redis.set(NOMINATIM_PING_CACHE_KEY, reachable ? '1' : '0', 'EX', 60);
      } catch (err) {
        this.logger.debug(`Redis write failed for Nominatim ping cache: ${(err as Error).message}`);
      }
    } else {
      this.nominatimPingCache = { reachable, at: now };
    }

    return reachable;
  }

  /** État de santé du geocoding — GET /geocoding/health. */
  async getHealthStatus(): Promise<{
    googlePlacesConfigured: boolean;
    googlePlacesLastError: string | null;
    googlePlacesFailureCount24h: number;
    nominatimReachable: boolean;
  }> {
    const [googleStats, nominatimReachable] = await Promise.all([
      this.getGoogleFailureStats(),
      this.checkNominatimReachable(),
    ]);
    return {
      googlePlacesConfigured: !!this.googleApiKey,
      googlePlacesLastError: googleStats.lastError,
      googlePlacesFailureCount24h: googleStats.count24h,
      nominatimReachable,
    };
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
      } catch (err) {
        this.logger.debug(`Redis cache read failed for ${cacheKey}: ${(err as Error).message}`);
      }
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
        await this.recordGooglePlacesFailure(`HTTP ${res.status} on placesAutocomplete`);
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
        } catch (err) {
          this.logger.debug(`Redis cache write failed for ${cacheKey}: ${(err as Error).message}`);
        }
      }

      return results;
    } catch (err: unknown) {
      this.logger.error(
        `Google Places API fetch/parse error for input="${input}": ${(err as Error).message}`,
      );
      await this.recordGooglePlacesFailure(`${(err as Error).message} (placesAutocomplete)`);
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
      } catch (err) {
        this.logger.debug(`Redis cache read failed for ${cacheKey}: ${(err as Error).message}`);
      }
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
        await this.recordGooglePlacesFailure(`HTTP ${res.status} on placeDetails`);
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
        } catch (err) {
          this.logger.debug(`Redis cache write failed for ${cacheKey}: ${(err as Error).message}`);
        }
      }

      return result;
    } catch (err: unknown) {
      this.logger.error(
        `Google Places Details API fetch/parse error for placeId="${placeId}": ${(err as Error).message}`,
      );
      await this.recordGooglePlacesFailure(`${(err as Error).message} (placeDetails)`);
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
      } catch (err) {
        this.logger.debug(`Redis cache read failed for ${cacheKey}: ${(err as Error).message}`);
      }
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
        // Sans countrycodes, une requête comme « Ambohipo » remonte d'abord des
        // homonymes hors Madagascar (nearby() le posait déjà, search() non).
        countrycodes: 'mg',
        addressdetails: '1',
        namedetails: '1',
      });
      if (results.length < 3) {
        params.set('viewbox', MG_VIEWBOX);
        // viewbox SEUL n'est qu'un critère de tri chez Nominatim ; sans
        // bounded=1 les résultats hors bbox remontent quand même.
        params.set('bounded', '1');
      }

      const url = `${NOMINATIM_BASE}/search?${params}`;

      try {
        // AbortController créé DANS le callback throttlé : sinon le budget de
        // 8 s courrait pendant l'attente en file, et une requête placée en
        // fin de file serait abandonnée avant même d'être émise.
        const res = await throttleNominatim(() => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          return fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
        });

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
          countrycodes: 'mg',
          addressdetails: '1',
          namedetails: '1',
        });
        try {
          const res = await throttleNominatim(() => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            return fetch(`${NOMINATIM_BASE}/search?${params}`, {
              headers: { 'User-Agent': USER_AGENT },
              signal: controller.signal,
            }).finally(() => clearTimeout(timeout));
          });
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
        } catch (err) {
          this.logger.debug(`Geocode query failed (best-effort): ${(err as Error).message}`);
          /* continue */
        }
        if (results.length >= 5) break;
      }
    }

    const final = results.slice(0, 20);
    if (this.redis && final.length > 0) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(final), 'EX', CACHE_TTL_SEC);
      } catch (err) {
        this.logger.debug(`Redis cache write failed for ${cacheKey}: ${(err as Error).message}`);
      }
    }

    return final;
  }

  async reverse(lat: number, lng: number): Promise<string | null> {
    const cacheKey = `geocode:reverse:${lat.toFixed(5)}:${lng.toFixed(5)}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return cached;
      } catch (err) {
        this.logger.debug(`Redis cache read failed for ${cacheKey}: ${(err as Error).message}`);
      }
    }

    const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=fr&addressdetails=1`;

    try {
      const res = await throttleNominatim(() => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 6000);
        return fetch(url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
      });

      if (!res.ok) return null;
      const data: any = await res.json();
      const result = data?.display_name || null;

      if (this.redis && result) {
        try {
          await this.redis.set(cacheKey, result, 'EX', CACHE_TTL_SEC);
        } catch (err) {
          this.logger.debug(`Redis cache write failed for ${cacheKey}: ${(err as Error).message}`);
        }
      }

      return result;
    } catch (err) {
      this.logger.debug(`Nominatim reverse geocode failed (best-effort): ${(err as Error).message}`);
      return null;
    }
  }

  async nearby(lat: number, lng: number): Promise<GeocodingResult[]> {
    const cacheKey = `geocode:nearby:${lat.toFixed(3)}:${lng.toFixed(3)}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch (err) {
        this.logger.debug(`Redis cache read failed for ${cacheKey}: ${(err as Error).message}`);
      }
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
        const res = await throttleNominatim(() => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          return fetch(url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal,
          }).finally(() => clearTimeout(timeout));
        });

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
} catch (err) {
          this.logger.debug(`Nearby geocode query failed (best-effort): ${(err as Error).message}`);
          /* continue */
        }

        if (results.length >= 20) break;
    }

    const final = results.slice(0, 25);
    if (this.redis && final.length > 0) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(final), 'EX', 3600);
      } catch (err) {
        this.logger.debug(`Redis cache write failed for ${cacheKey}: ${(err as Error).message}`);
      }
    }

    return final;
  }
}
