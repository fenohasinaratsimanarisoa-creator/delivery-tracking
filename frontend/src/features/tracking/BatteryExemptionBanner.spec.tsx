import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BatteryExemptionBanner from './BatteryExemptionBanner';
import type { TrackingStatus } from '../../hooks/useDriverTracking';

function baseStatus(overrides: Partial<TrackingStatus> = {}): TrackingStatus {
  return {
    active: true,
    position: null,
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
    requestBatteryExemption: vi.fn().mockResolvedValue(undefined),
    deviceOem: null,
    openOemSettings: vi.fn().mockResolvedValue(undefined),
    openOemBatterySaverSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const AGGRESSIVE_XIAOMI = {
  oem: 'xiaomi',
  manufacturer: 'Xiaomi',
  brand: 'Redmi',
  model: 'Redmi 9T',
  os: '10',
  sdkInt: 29,
  aggressive: true,
  hasBatterySaverScreen: true,
  batteryOptimizationIgnored: true,
};

// =============================================================================
// RÉGRESSION COUVERTE ICI (audit terrain 2026-08-27, cause racine confirmée en
// conditions réelles) : la section réglages constructeur (autostart + économie
// d'énergie MIUI) était imbriquée DANS la bannière batterie, donc cachée dès
// que batteryOptimizationIgnored passait à true — alors que le réglage MIUI
// "économie d'énergie par application" est INDÉPENDANT et tout aussi
// nécessaire. Cas réel : exemption Android accordée, mais 3 coupures de
// tracking de 1h30-2h en une journée à cause de ce réglage resté par défaut.
// =============================================================================
describe('BatteryExemptionBanner (audit terrain 2026-08-27)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("n'affiche rien quand tout est en ordre (exemption accordée, OEM non agressif)", () => {
    const { container } = render(
      <BatteryExemptionBanner status={baseStatus({ batteryOptimizationIgnored: true, deviceOem: null })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("affiche la bannière batterie quand l'exemption n'est PAS accordée", () => {
    render(<BatteryExemptionBanner status={baseStatus({ batteryOptimizationIgnored: false })} />);
    expect(screen.getByText('Optimisation batterie active')).toBeTruthy();
  });

  it("BUG CORRIGÉ : affiche la section réglages OEM MÊME quand l'exemption batterie standard est déjà accordée", () => {
    render(
      <BatteryExemptionBanner
        status={baseStatus({ batteryOptimizationIgnored: true, deviceOem: AGGRESSIVE_XIAOMI })}
      />,
    );
    // La bannière batterie standard ne doit PAS s'afficher (déjà accordée)...
    expect(screen.queryByText('Optimisation batterie active')).toBeNull();
    // ...mais la section OEM doit rester visible (réglage MIUI indépendant).
    expect(screen.getByText('Démarrage automatique')).toBeTruthy();
  });

  it('affiche le bouton "Économie d\'énergie" uniquement si hasBatterySaverScreen', () => {
    render(
      <BatteryExemptionBanner
        status={baseStatus({ batteryOptimizationIgnored: true, deviceOem: AGGRESSIVE_XIAOMI })}
      />,
    );
    expect(screen.getByText("Économie d'énergie")).toBeTruthy();
  });

  it('masque le bouton "Économie d\'énergie" si hasBatterySaverScreen est false (ex. EMUI/ColorOS)', () => {
    render(
      <BatteryExemptionBanner
        status={baseStatus({
          batteryOptimizationIgnored: true,
          deviceOem: { ...AGGRESSIVE_XIAOMI, oem: 'huawei', hasBatterySaverScreen: false },
        })}
      />,
    );
    expect(screen.getByText('Démarrage automatique')).toBeTruthy();
    expect(screen.queryByText("Économie d'énergie")).toBeNull();
  });

  it('le dismiss masque la section OEM et persiste (localStorage)', () => {
    const { unmount } = render(
      <BatteryExemptionBanner
        status={baseStatus({ batteryOptimizationIgnored: true, deviceOem: AGGRESSIVE_XIAOMI })}
      />,
    );
    fireEvent.click(screen.getByText("C'est déjà fait, ne plus afficher"));
    expect(screen.queryByText('Démarrage automatique')).toBeNull();
    unmount();

    // Un nouveau montage (ex. changement de page) doit respecter le dismiss persisté.
    render(
      <BatteryExemptionBanner
        status={baseStatus({ batteryOptimizationIgnored: true, deviceOem: AGGRESSIVE_XIAOMI })}
      />,
    );
    expect(screen.queryByText('Démarrage automatique')).toBeNull();
  });

  it('appelle openOemBatterySaverSettings au clic sur le bouton dédié', () => {
    const openOemBatterySaverSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <BatteryExemptionBanner
        status={baseStatus({
          batteryOptimizationIgnored: true,
          deviceOem: AGGRESSIVE_XIAOMI,
          openOemBatterySaverSettings,
        })}
      />,
    );
    fireEvent.click(screen.getByText("Économie d'énergie"));
    expect(openOemBatterySaverSettings).toHaveBeenCalledTimes(1);
  });
});
