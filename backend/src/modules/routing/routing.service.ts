import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DirectionsRequestDto,
  DirectionsResponse,
  RouteStep,
  MatchRequestDto,
  MatchResponse,
  OptimizeTripDto,
  OptimizeTripResponse,
} from './dto/routing.dto';

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);
  private readonly osrmBaseUrl: string;

  constructor(private configService: ConfigService) {
    this.osrmBaseUrl = this.configService.get<string>('OSRM_BASE_URL') || 'http://localhost:5000';
  }

  async getDirections(dto: DirectionsRequestDto): Promise<DirectionsResponse> {
    // Un seul fournisseur : l'OSRM auto-hébergé. Conformité DPA (LEGAL.md §8,
    // DPA.md §5.4 — liste fermée de sous-traitants, hébergement UE, préavis 30j) :
    // AUCUN fallback vers des sous-traitants non déclarés (OSRM public
    // router.project-osrm.org, Google Directions). Les données de routage ne
    // sortent jamais de l'infrastructure auto-hébergée.
    try {
      return await this.getOsrmDirections(dto, this.osrmBaseUrl);
    } catch (err: any) {
      // Réponse OSRM valide mais sans itinéraire (NoRoute/InvalidQuery) : erreur
      // 422 claire remontée telle quelle au client — pas une panne, pas de fallback.
      if (err instanceof HttpException) throw err;
      // Vraie panne de l'OSRM local (timeout / connexion refusée / HTTP >= 400).
      this.logger.error(`Local OSRM failed: ${err.message}`);
      throw new HttpException('Routing unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private extractRouteData(route: {
    geometry: { coordinates: [number, number][] };
    distance: number;
    duration: number;
    legs: Array<{
      steps: Array<{
        distance: number;
        duration: number;
        name: string;
        maneuver: {
          instruction?: string;
          type?: string;
          modifier?: string;
          exit?: number;
        };
        geometry: { coordinates: [number, number][] };
      }>;
    }>;
  }) {
    const polyline: [number, number][] = route.geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );
    const steps: RouteStep[] = [];
    for (const leg of route.legs) {
      for (const step of leg.steps) {
        const stepWaypoints: [number, number][] = step.geometry.coordinates.map(
          (c) => [c[1], c[0]] as [number, number],
        );
        steps.push({
          distance: step.distance,
          duration: step.duration,
          instruction: step.maneuver?.instruction || '',
          waypoints: stepWaypoints,
          maneuverType: step.maneuver?.type,
          maneuverModifier: step.maneuver?.modifier,
          streetName: step.name,
        });
      }
    }
    return { polyline, distance: route.distance, duration: route.duration, steps };
  }

  private async getOsrmDirections(
    dto: DirectionsRequestDto,
    baseUrl: string,
  ): Promise<DirectionsResponse> {
    const profile = dto.profile || 'driving';
    const alternativesParam = dto.alternatives ? '&alternatives=3' : '';
    const url = `${baseUrl}/route/v1/${profile}/${dto.originLng},${dto.originLat};${dto.destinationLng},${dto.destinationLat}?overview=full&geometries=geojson&steps=true${alternativesParam}`;

    this.logger.debug(`OSRM request: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`OSRM HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      code: string;
      routes: Array<{
        geometry: { coordinates: [number, number][] };
        distance: number;
        duration: number;
        legs: Array<{
          steps: Array<{
            distance: number;
            duration: number;
            name: string;
            maneuver: {
              instruction?: string;
              type?: string;
              modifier?: string;
              exit?: number;
            };
            geometry: { coordinates: [number, number][] };
          }>;
        }>;
      }>;
    };

    if (data.code !== 'Ok' || !data.routes?.length) {
      // Réponse OSRM valide mais sans itinéraire (NoRoute/InvalidQuery) : ce n'est
      // pas une panne mais une absence de route pour ces coordonnées. Erreur 422
      // claire au client, aucun fallback externe déclenché.
      throw new HttpException(
        'Aucun itinéraire trouvé pour ces coordonnées',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const main = this.extractRouteData(data.routes[0]);
    const alternatives: {
      polyline: [number, number][];
      distance: number;
      duration: number;
      steps: RouteStep[];
    }[] = [];
    if (dto.alternatives && data.routes.length > 1) {
      for (let i = 1; i < data.routes.length; i++) {
        alternatives.push(this.extractRouteData(data.routes[i]));
      }
    }

    return {
      polyline: main.polyline,
      distance: main.distance,
      duration: main.duration,
      steps: main.steps,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      provider: 'osrm',
    };
  }

  /**
   * Optimisation de tournée multi-arrêts (mvpromax.md §1.1) : résout l'ORDRE de
   * passage qui minimise la distance/durée totale sur les points fournis, via
   * le service `/trip/` d'OSRM (résolution TSP approchée, déjà supporté par
   * notre instance osrm-routed --algorithm mld, aucune config OSRM à changer).
   *
   * `roundtrip=false&source=first&destination=any` : BUG CORRIGÉ EN PROD
   * (2026-09-18) — `source=any&destination=any` (pas de départ/arrivée fixé du
   * tout) semblait le choix logique vu l'absence de dépôt fixe dans le schéma
   * Delivery, mais OSRM renvoie 400 "NotImplemented" pour cette combinaison :
   * un TSP ouvert (pas un circuit fermé) sans AUCUNE extrémité fixée n'est pas
   * un problème qu'OSRM résout — il faut fixer au moins une extrémité (vérifié
   * empiriquement contre l'instance osrm-routed réelle, pas dans la doc). On
   * fixe le DÉPART sur le premier point fourni (ordre d'entrée arbitraire côté
   * appelant — aucun dépôt réel), l'arrivée reste libre : OSRM optimise
   * librement l'ordre des points restants. `roundtrip=true` (circuit fermé)
   * aurait aussi marché mais fausserait la distance totale affichée (ajoute un
   * retour au point de départ que le chauffeur ne fait jamais en réalité).
   * Même politique « aucun fallback externe » que getOsrmDirections/
   * matchToRoad (conformité DPA — voir leurs commentaires).
   */
  async optimizeTrip(dto: OptimizeTripDto): Promise<OptimizeTripResponse> {
    const profile = dto.profile || 'driving';
    const coords = dto.coordinates.map((c) => `${c[1]},${c[0]}`).join(';');
    const url = `${this.osrmBaseUrl}/trip/v1/${profile}/${coords}?roundtrip=false&source=first&destination=any&geometries=geojson&overview=full&steps=false`;

    this.logger.debug(`OSRM trip request: ${url}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } catch (err: any) {
      this.logger.error(`Local OSRM trip failed: ${err.message}`);
      throw new HttpException('Routing unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // Corps de la réponse loggé (pas juste le status) : c'est ce qui a permis
      // de diagnostiquer le vrai problème en prod (400 "NotImplemented" d'OSRM,
      // pas une panne) — un simple "HTTP 400" n'aurait pas suffi sans SSH+curl
      // manuel contre osrm-routed.
      const body = await response.text().catch(() => '');
      this.logger.error(`Local OSRM trip failed: HTTP ${response.status} — ${body}`);
      throw new HttpException('Routing unavailable', HttpStatus.SERVICE_UNAVAILABLE);
    }

    const data = (await response.json()) as {
      code: string;
      waypoints?: Array<{ waypoint_index: number }>;
      trips?: Array<{
        geometry: { coordinates: [number, number][] };
        distance: number;
        duration: number;
      }>;
    };

    if (data.code !== 'Ok' || !data.trips?.length || !data.waypoints?.length) {
      // Réponse OSRM valide mais sans tournée possible (points trop isolés du
      // réseau routier, etc.) : pas une panne, 422 clair, aucun fallback.
      throw new HttpException(
        'Aucune tournée trouvée pour ces coordonnées',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // `waypoints` est renvoyé dans l'ORDRE D'ENTRÉE ; waypoint_index donne la
    // position de CE point dans la tournée optimisée. On reconstruit `order`
    // (indices d'entrée triés par position optimale) à partir de ça.
    const order = data.waypoints
      .map((wp, inputIndex) => ({ inputIndex, position: wp.waypoint_index }))
      .sort((a, b) => a.position - b.position)
      .map((w) => w.inputIndex);

    const trip = data.trips[0];
    const polyline: [number, number][] = trip.geometry.coordinates.map(
      (c) => [c[1], c[0]] as [number, number],
    );

    return {
      order,
      polyline,
      distance: trip.distance,
      duration: trip.duration,
      provider: 'osrm',
    };
  }

  async matchToRoad(dto: MatchRequestDto): Promise<MatchResponse> {
    const coords = dto.coordinates.map((c) => `${c[1]},${c[0]}`).join(';');
    const radiuses = dto.radiuses?.join(';') || '';
    const profile = dto.profile || 'driving';

    const tryMatch = async (baseUrl: string): Promise<MatchResponse> => {
      let url = `${baseUrl}/match/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false`;
      if (radiuses) url += `&radiuses=${radiuses}`;

      this.logger.debug(`OSRM match request: ${url}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), dto.timeoutMs ?? 15000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`OSRM match HTTP ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as {
        code: string;
        matchings: Array<{
          confidence: number;
          geometry: { coordinates: [number, number][] };
          distance: number;
          duration: number;
        }>;
        tracepoints: Array<{
          location: [number, number];
          waypoint_index: number;
        } | null>;
      };

      if (data.code !== 'Ok' || !data.matchings?.length) {
        throw new Error(`OSRM match failed: ${data.code}`);
      }

      const best = data.matchings[0];
      const matchedPolyline: [number, number][] = best.geometry.coordinates.map(
        (c) => [c[1], c[0]] as [number, number],
      );

      // Point accroché du DERNIER fix d'entrée : tracepoints[i] correspond à la
      // coordonnée d'entrée i ; null = ce point est un aberrant non-accroché. Pour
      // le suivi temps réel on ne veut QUE l'accrochage du fix courant — si OSRM
      // n'a pas pu le placer sur une route, on garde le brut (pas d'accrochage
      // d'un fix plus ancien qui ferait « reculer » le marqueur).
      const tps = data.tracepoints ?? [];
      const lastLoc = tps.length > 0 ? tps[tps.length - 1]?.location : undefined;
      const snappedTail: [number, number] | null =
        lastLoc && Number.isFinite(lastLoc[0]) && Number.isFinite(lastLoc[1])
          ? [lastLoc[1], lastLoc[0]] // OSRM renvoie [lng, lat] → [lat, lng]
          : null;

      return {
        matchedPolyline,
        confidence: best.confidence,
        originalPolyline: dto.coordinates.map((c) => [c[0], c[1]] as [number, number]),
        snappedTail,
      };
    };

    let lastError: Error | null = null;

    try {
      return await tryMatch(this.osrmBaseUrl);
    } catch (err: any) {
      lastError = err as Error;
      this.logger.warn(`Local OSRM match failed: ${lastError.message}`);
    }

    // Pas de matching disponible : on renvoie la trace originale avec confidence 0.
    // Aucune donnée externe n'est appelée (conformité DPA — pas de fallback vers
    // l'OSRM public ni Google).
    this.logger.warn('Map matching unavailable — returning original trace');
    return {
      matchedPolyline: dto.coordinates.map((c) => [c[0], c[1]] as [number, number]),
      confidence: 0,
      originalPolyline: dto.coordinates.map((c) => [c[0], c[1]] as [number, number]),
      snappedTail: null,
    };
  }

  /**
   * Distance de trajet (mètres) accrochée au réseau routier réel, pour un
   * SEGMENT de trace GPS continu (audit sous-comptage carburant 2026-09-15 —
   * voir common/geo/route-distance.ts, qui appelle ceci par morceaux sur une
   * journée entière). Contrairement à `matchToRoad` (map-matching TEMPS RÉEL,
   * qui ne garde que le point accroché du dernier fix), on a ici besoin de la
   * distance CUMULÉE du meilleur matching OSRM.
   *
   * Politique volontairement STRICTE (jamais de reconstruction partielle) :
   * `null` dès que le morceau se scinde en plusieurs matchings OSRM (trace
   * discontinue) ou qu'un tracepoint n'a pas pu être accroché — l'appelant
   * retombe alors sur computeFilteredDistance pour tout le morceau plutôt que
   * de risquer un double-comptage ou un trou aux limites d'un sous-matching.
   * Ne compte QUE si l'unique matching couvre l'intégralité des points fournis
   * avec une confiance suffisante.
   */
  async matchRouteDistance(
    dto: MatchRequestDto,
  ): Promise<{ distance: number; confidence: number } | null> {
    const coords = dto.coordinates.map((c) => `${c[1]},${c[0]}`).join(';');
    const radiuses = dto.radiuses?.join(';') || '';
    const profile = dto.profile || 'driving';
    let url = `${this.osrmBaseUrl}/match/v1/${profile}/${coords}?overview=false&geometries=geojson&steps=false`;
    if (radiuses) url += `&radiuses=${radiuses}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), dto.timeoutMs ?? 15000);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new Error(`OSRM match HTTP ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      code: string;
      matchings: Array<{ confidence: number; distance: number }>;
      tracepoints: Array<{ location: [number, number]; waypoint_index: number } | null>;
    };

    if (data.code !== 'Ok' || !data.matchings?.length) return null;
    // Trace scindée en plusieurs matchings OSRM (gap non pontable) ou point non
    // accroché : reconstruction fiable impossible sans risquer un double-compte
    // ou un trou — l'appelant retombe sur computeFilteredDistance pour ce morceau.
    if (data.matchings.length !== 1) return null;
    if ((data.tracepoints ?? []).some((tp) => tp === null)) return null;

    const best = data.matchings[0];
    return { distance: best.distance, confidence: best.confidence };
  }
}
