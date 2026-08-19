import { describe, it, expect } from 'vitest';
import {
  mergePositionUpdate,
  mergeBootstrapPositions,
  shouldFollowRecenter,
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
