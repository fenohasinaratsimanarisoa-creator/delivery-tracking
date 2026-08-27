import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import TrackingStatusIndicator from './TrackingStatusIndicator';
import type { TrackingStatus } from '../hooks/useDriverTracking';

function baseStatus(overrides: Partial<TrackingStatus> = {}): TrackingStatus {
  return {
    active: true,
    position: { lat: -18.8792, lng: 47.5079, timestamp: Date.now() },
    positionSource: 'phone',
    confidence: 1,
    poorAccuracy: false,
    degradedAccuracyWhileMoving: 0,
    isStationary: false,
    queueCount: 0,
    socketConnected: true,
    networkOnline: true,
    sessionExpired: false,
    statusMsg: '',
    geolocationDenied: false,
    insecureContext: false,
    activeDeliveryId: '',
    alerts: [],
    dismissAlert: () => {},
    batteryOptimizationIgnored: true,
    requestBatteryExemption: async () => {},
    deviceOem: null,
    openOemSettings: async () => {},
    openOemBatterySaverSettings: async () => {},
    ...overrides,
  };
}

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit GPS 2026-08-27) : une fois qu'une position a
// été acquise, une coupure réseau/précision TRANSITOIRE ne doit plus faire
// clignoter un badge d'alerte — le pipeline local (SQLite + WorkManager,
// aucune perte vérifiée sur 9h de test réel) continue de fonctionner. Seul un
// cas exigeant une VRAIE action du chauffeur (session expirée) doit rester
// visible en toute circonstance.
// =============================================================================
describe('TrackingStatusIndicator — pas de badge alarmant pour une coupure transitoire (audit GPS 2026-08-27)', () => {
  it('affiche "En route" quand tout va bien', () => {
    render(<TrackingStatusIndicator status={baseStatus({ isStationary: false })} />);
    expect(screen.getByText('En route')).toBeTruthy();
  });

  it('affiche "Arrêté" quand le véhicule est stationnaire', () => {
    render(<TrackingStatusIndicator status={baseStatus({ isStationary: true })} />);
    expect(screen.getByText('Arrêté')).toBeTruthy();
  });

  it('continue d\'afficher "En route" malgré une précision dégradée, une fois une position acquise', () => {
    render(<TrackingStatusIndicator status={baseStatus({ poorAccuracy: true })} />);
    expect(screen.getByText('En route')).toBeTruthy();
    expect(screen.queryByText('GPS faible')).toBeNull();
  });

  it('continue d\'afficher "En route" malgré une coupure réseau transitoire, une fois une position acquise', () => {
    render(<TrackingStatusIndicator status={baseStatus({ networkOnline: false })} />);
    expect(screen.getByText('En route')).toBeTruthy();
    expect(screen.queryByText('Pas de réseau')).toBeNull();
  });

  it('affiche "Pas de réseau" si AUCUNE position n\'a jamais été acquise (vrai état initial)', () => {
    render(<TrackingStatusIndicator status={baseStatus({ position: null, networkOnline: false })} />);
    expect(screen.getByText('Pas de réseau')).toBeTruthy();
  });

  it('affiche "Recherche signal..." si aucune position et réseau OK (vrai état initial)', () => {
    render(<TrackingStatusIndicator status={baseStatus({ position: null })} />);
    expect(screen.getByText('Recherche signal...')).toBeTruthy();
  });

  it('affiche TOUJOURS "Session expirée" même avec une position acquise (vraie action requise)', () => {
    render(<TrackingStatusIndicator status={baseStatus({ sessionExpired: true })} />);
    expect(screen.getByText(/Session expirée/)).toBeTruthy();
  });

  it('le traceur GPS physique reste prioritaire sur tout le reste', () => {
    render(<TrackingStatusIndicator status={baseStatus({ positionSource: 'physical_tracker', sessionExpired: true })} />);
    expect(screen.getByText('Traceur GPS')).toBeTruthy();
  });
});
