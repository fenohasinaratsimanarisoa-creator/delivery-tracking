import { describe, it, expect } from 'vitest';
import {
  mergePositionUpdate,
  mergeBootstrapPositions,
  shouldFollowRecenter,
  effectiveStatus,
  formatVehicleSpeed,
  liveSpeedLabel,
  isMovingSpeed,
  STALE_MOVEMENT_MS,
  OFFLINE_TIMEOUT_MIN,
  SIGNAL_LOST_MS,
  signalLostSinceMs,
  FALLBACK_DRIVER_NAME,
  type PositionUpdateInput,
  type VehicleData,
} from './vehicleMap';

const baseUpdate = (vehicleId: string, driverId: string | undefined): PositionUpdateInput => ({
  vehicleId,
  driverId,
  driverName: 'Jean Rakoto',
  latitude: -18.8792,
  longitude: 47.5079,
  speed: 5,
  heading: 90,
  accuracy: 6,
  timestamp: '2026-08-13T08:00:00.000Z',
});

describe('mergePositionUpdate — Map indexée par vehicleId (jamais driverId)', () => {
  it('Test C : deux updates socket avec driverId=undefined mais vehicleId différents produisent 2 entrées distinctes', () => {
    const map = new Map<string, VehicleData>();
    const v1 = baseUpdate('vehicle-1', undefined);
    const v2 = baseUpdate('vehicle-2', undefined);

    const after = mergePositionUpdate(mergePositionUpdate(map, v1), v2);

    expect(after.size).toBe(2);
    const entries = Array.from(after.values());
    expect(entries.map((e) => e.vehicleId).sort()).toEqual(['vehicle-1', 'vehicle-2']);
    expect(entries.map((e) => e.id).sort()).toEqual(['vehicle-1', 'vehicle-2']);
  });

  it('deux véhicules avec le même driverId restent distincts (clé = vehicleId)', () => {
    const map = new Map<string, VehicleData>();
    const v1 = baseUpdate('vehicle-1', 'driver-1');
    const v2 = baseUpdate('vehicle-2', 'driver-1');

    const after = mergePositionUpdate(mergePositionUpdate(map, v1), v2);

    expect(after.size).toBe(2);
  });

  it('un update du même véhicule met à jour l\'entrée existante (pas de doublon)', () => {
    const map = new Map<string, VehicleData>();
    const first = baseUpdate('vehicle-1', undefined);
    const second = { ...first, latitude: -18.88, speed: 0 };

    const after = mergePositionUpdate(mergePositionUpdate(map, first), second);

    expect(after.size).toBe(1);
    expect(after.get('vehicle-1')!.lat).toBe(-18.88);
    expect(after.get('vehicle-1')!.name).toBe('Jean Rakoto');
  });

  it('driverName absent → nom de repli pour un véhicule sans chauffeur résolu', () => {
    const map = new Map<string, VehicleData>();
    const update = { ...baseUpdate('vehicle-1', undefined), driverName: undefined };

    const after = mergePositionUpdate(map, update);

    expect(after.get('vehicle-1')!.name).toBe(FALLBACK_DRIVER_NAME);
  });
});

describe('mergeBootstrapPositions — bootstrap REST par vehicleId', () => {
  it('deux positions REST avec driverName manquant produisent 2 entrées distinctes', () => {
    const map = new Map<string, VehicleData>();
    const pos1 = { ...baseUpdate('vehicle-1', undefined), driverName: undefined, minutesAgo: 1 };
    const pos2 = { ...baseUpdate('vehicle-2', undefined), driverName: undefined, minutesAgo: 2 };

    const after = mergeBootstrapPositions(map, [pos1, pos2]);

    expect(after.size).toBe(2);
    expect(after.get('vehicle-1')!.name).toBe(FALLBACK_DRIVER_NAME);
    expect(after.get('vehicle-2')!.name).toBe(FALLBACK_DRIVER_NAME);
  });
});

describe('effectiveStatus — dégradation du statut affiché avec le temps (traceur motion-triggered)', () => {
  // Régression 2026-09-06 signalée en prod : un véhicule réellement arrêté
  // depuis 5 min affichait toujours "EN MOUVEMENT" — le traceur physique
  // n'envoie AUCUNE position à l'arrêt, donc `vehicle.status` (figé au dernier
  // update reçu par mergePositionUpdate) ne se corrigeait jamais tout seul.
  const T0 = new Date('2026-09-06T18:07:49.000Z').getTime();

  it('reste "moving" tant que la dernière position est récente', () => {
    expect(effectiveStatus('moving', new Date(T0).toISOString(), T0 + 30_000)).toBe('moving');
  });

  it('passe "moving" → "static" après STALE_MOVEMENT_MS sans nouvelle position', () => {
    expect(effectiveStatus('moving', new Date(T0).toISOString(), T0 + STALE_MOVEMENT_MS + 1000)).toBe('static');
  });

  it('passe "static" → "offline" après OFFLINE_TIMEOUT_MIN sans nouvelle position', () => {
    const offlineAt = T0 + OFFLINE_TIMEOUT_MIN * 60_000 + 1000;
    expect(effectiveStatus('static', new Date(T0).toISOString(), offlineAt)).toBe('offline');
    expect(effectiveStatus('moving', new Date(T0).toISOString(), offlineAt)).toBe('offline');
  });

  it('un statut déjà "offline" (bootstrap REST) reste "offline", quel que soit `now`', () => {
    expect(effectiveStatus('offline', new Date(T0).toISOString(), T0)).toBe('offline');
  });

  it('sans timestamp, ne dégrade jamais un statut réel (garde-fou, ne devrait pas arriver en pratique)', () => {
    expect(effectiveStatus('moving', undefined, T0 + 999_999_999)).toBe('moving');
  });
});

describe('signalLostSinceMs — avertissement précoce « signal perdu » (audit TEMPS RÉEL 2026-09-09)', () => {
  const T0 = new Date('2026-09-09T14:07:00.000Z').getTime();
  const ts = new Date(T0).toISOString();

  it('null tant que le signal est frais (< SIGNAL_LOST_MS)', () => {
    expect(signalLostSinceMs(ts, T0 + 20_000)).toBeNull();
    expect(signalLostSinceMs(ts, T0 + SIGNAL_LOST_MS)).toBeNull();
  });

  it('retourne l\'âge du signal une fois SIGNAL_LOST_MS dépassé', () => {
    expect(signalLostSinceMs(ts, T0 + SIGNAL_LOST_MS + 5_000)).toBe(SIGNAL_LOST_MS + 5_000);
    expect(signalLostSinceMs(ts, T0 + 4 * 60_000)).toBe(4 * 60_000);
  });

  it('null au-delà de OFFLINE_TIMEOUT_MIN : le badge « hors ligne » dédié prend le relais', () => {
    expect(signalLostSinceMs(ts, T0 + OFFLINE_TIMEOUT_MIN * 60_000 + 1_000)).toBeNull();
  });

  it('null si le timestamp est absent (pas d\'info exploitable)', () => {
    expect(signalLostSinceMs(undefined, T0)).toBeNull();
  });
});

describe('shouldFollowRecenter — suivi CONTINU de la caméra (le bug #1 de l\'audit)', () => {
  it('retourne true à la PREMIÈRE position d\'un véhicule sélectionné (aucune référence)', () => {
    expect(shouldFollowRecenter(null, { id: 'v1', lat: -18.8792, lng: 47.5079 })).toBe(true);
  });

  it('retourne true à CHAQUE nouvelle position du véhicule suivi — pas seulement à la première', () => {
    // Le défaut corrigé : l\'ancien code (snapshot figé + garde focusId) ne
    // recentrait qu\'une seule fois ; la caméra doit maintenant suivre chaque
    // mouvement reçu.
    const prev = { id: 'v1', lat: -18.8792, lng: 47.5079 };
    expect(shouldFollowRecenter(prev, { id: 'v1', lat: -18.8801, lng: 47.5079 })).toBe(true);
    expect(shouldFollowRecenter(prev, { id: 'v1', lat: -18.8792, lng: 47.5100 })).toBe(true);
    expect(shouldFollowRecenter(prev, { id: 'v1', lat: -18.8795, lng: 47.5083 })).toBe(true);
  });

  it('retourne false quand les coordonnées n\'ont pas changé (pas de panTo inutile)', () => {
    const prev = { id: 'v1', lat: -18.8792, lng: 47.5079 };
    expect(shouldFollowRecenter(prev, { id: 'v1', lat: -18.8792, lng: 47.5079 })).toBe(false);
  });

  it('recentre quand on passe d\'un véhicule à un autre (changement de sélection)', () => {
    const prev = { id: 'v1', lat: -18.8792, lng: 47.5079 };
    expect(shouldFollowRecenter(prev, { id: 'v2', lat: -18.8792, lng: 47.5079 })).toBe(true);
  });
});

describe('formatVehicleSpeed / isMovingSpeed — plancher de stationnarité (audit VITESSE FANTÔME 2026-09-09)', () => {
  it('une vitesse fantôme (< 0,5 m/s) est affichée « À l\'arrêt », jamais en km/h', () => {
    expect(formatVehicleSpeed(0)).toBe("À l'arrêt");
    expect(formatVehicleSpeed(0.4)).toBe("À l'arrêt"); // ≈ 1,4 km/h de bruit
    expect(formatVehicleSpeed(null)).toBe("À l'arrêt");
    expect(formatVehicleSpeed(undefined)).toBe("À l'arrêt");
  });

  it('une vitesse réelle est affichée en km/h', () => {
    expect(formatVehicleSpeed(5)).toBe('18.0 km/h');
  });

  it('isMovingSpeed ne considère « en mouvement » qu\'au-dessus du plancher', () => {
    expect(isMovingSpeed(0.4)).toBe(false);
    expect(isMovingSpeed(0.5)).toBe(false);
    expect(isMovingSpeed(0.6)).toBe(true);
    expect(isMovingSpeed(null)).toBe(false);
  });

  it('mergePositionUpdate : une vitesse fantôme ne met PAS le véhicule « moving »', () => {
    const upd: PositionUpdateInput = {
      vehicleId: 'v1',
      driverName: 'X',
      latitude: -18.8792,
      longitude: 47.5079,
      speed: 0.4,
      timestamp: '2026-09-09T08:00:00.000Z',
    };
    const m = mergePositionUpdate(new Map(), upd);
    expect(m.get('v1')?.status).toBe('static');
  });

  it('liveSpeedLabel : « À l\'arrêt » dès que le véhicule n\'est plus activement en mouvement', () => {
    const T0 = Date.parse('2026-09-09T08:00:00.000Z');
    const ts = new Date(T0).toISOString();
    // Position fraîche + statut moving + vraie vitesse → affichée.
    expect(liveSpeedLabel(12, 'moving', ts, T0 + 30_000)).toBe('43.2 km/h');
    // Même vitesse mais dernière position vieille de 20 min → HORS LIGNE → « À l'arrêt ».
    expect(liveSpeedLabel(12, 'moving', ts, T0 + 20 * 60_000)).toBe("À l'arrêt");
    // Statut static (véhicule garé) → « À l'arrêt » quelle que soit la vitesse figée.
    expect(liveSpeedLabel(1.67, 'static', ts, T0 + 30_000)).toBe("À l'arrêt");
    // Régression signalée : traceur endormi 17 h, dernier fix à 6 km/h → plus « 6.0 km/h ».
    expect(liveSpeedLabel(1.67, 'moving', ts, T0 + 17 * 3_600_000)).toBe("À l'arrêt");
  });
});

describe('displayLatitude/displayLongitude — position affichée vs coordonnées brutes (audit PRÉCISION GPS 2026-09-09)', () => {
  it('mergePositionUpdate : lat/lng = position affichée (ancre), rawLat/rawLng = fix brut', () => {
    const upd: PositionUpdateInput = {
      vehicleId: 'v1',
      driverName: 'X',
      latitude: -18.8635, // fix brut (faible, au sud)
      longitude: 47.5638,
      displayLatitude: -18.8632, // ancre serveur (recalée)
      displayLongitude: 47.5639,
      speed: 0,
      timestamp: '2026-09-09T08:00:00.000Z',
    };
    const v = mergePositionUpdate(new Map(), upd).get('v1')!;
    expect(v.lat).toBe(-18.8632);
    expect(v.lng).toBe(47.5639);
    expect(v.rawLat).toBe(-18.8635);
    expect(v.rawLng).toBe(47.5638);
  });

  it('mergePositionUpdate : sans displayLatitude → lat/lng = brut (rétrocompat)', () => {
    const upd: PositionUpdateInput = {
      vehicleId: 'v1',
      driverName: 'X',
      latitude: -18.8635,
      longitude: 47.5638,
      speed: 3,
      timestamp: '2026-09-09T08:00:00.000Z',
    };
    const v = mergePositionUpdate(new Map(), upd).get('v1')!;
    expect(v.lat).toBe(-18.8635);
    expect(v.rawLat).toBe(-18.8635);
  });

  it('mergePositionUpdate : un point suspect ne bouge PAS la position affichée mais rafraîchit le brut', () => {
    const start = mergePositionUpdate(new Map(), {
      vehicleId: 'v1',
      driverName: 'X',
      latitude: -18.8632,
      longitude: 47.5639,
      displayLatitude: -18.8632,
      displayLongitude: 47.5639,
      speed: 0,
      timestamp: '2026-09-09T08:00:00.000Z',
    });
    const after = mergePositionUpdate(start, {
      vehicleId: 'v1',
      driverName: 'X',
      latitude: -18.9, // glitch
      longitude: 47.6,
      speed: 0,
      suspect: true,
      timestamp: '2026-09-09T08:00:05.000Z',
    });
    const v = after.get('v1')!;
    expect(v.lat).toBe(-18.8632); // inchangé
    expect(v.rawLat).toBe(-18.9); // le fix glitché
    expect(v.suspect).toBe(true);
  });

  it('mergeBootstrapPositions : displayLatitude appliquée, brut conservé', () => {
    const v = mergeBootstrapPositions(new Map(), [
      {
        vehicleId: 'v1',
        driverName: 'X',
        latitude: -18.8635,
        longitude: 47.5638,
        displayLatitude: -18.8632,
        displayLongitude: 47.5639,
        speed: 0,
        timestamp: '2026-09-09T08:00:00.000Z',
        minutesAgo: 1,
      },
    ]).get('v1')!;
    expect(v.lat).toBe(-18.8632);
    expect(v.rawLat).toBe(-18.8635);
  });
});
