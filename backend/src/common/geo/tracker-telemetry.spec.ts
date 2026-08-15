import {
  extractTrackerTelemetry,
  toJsonValue,
  isPowerCut,
  isBatteryCritical,
  POWER_CUT_VOLTS,
  BATTERY_CRITICAL_PCT,
} from './tracker-telemetry';

describe('tracker-telemetry — extraction protocolo-agnostique', () => {
  it('retourne null sur tous les champs quand attributes est absent (modèle bas de gamme)', () => {
    expect(extractTrackerTelemetry(undefined)).toEqual({
      powerVolts: null,
      batteryPercent: null,
      ignition: null,
    });
    expect(extractTrackerTelemetry(null)).toEqual({
      powerVolts: null,
      batteryPercent: null,
      ignition: null,
    });
    expect(extractTrackerTelemetry({})).toEqual({
      powerVolts: null,
      batteryPercent: null,
      ignition: null,
    });
  });

  it('interprète power exprimé en VOLTS (~12) directement', () => {
    expect(extractTrackerTelemetry({ power: 12.4 }).powerVolts).toBe(12.4);
    expect(extractTrackerTelemetry({ power: 0 }).powerVolts).toBe(0);
  });

  it('interprète power exprimé en MILLIVOLTS (~12400) en divisant par 1000', () => {
    expect(extractTrackerTelemetry({ power: 12400 }).powerVolts).toBe(12.4);
  });

  it('interprète battery exprimé en POURCENTAGE (0-100) directement', () => {
    expect(extractTrackerTelemetry({ battery: 85 }).batteryPercent).toBe(85);
    expect(extractTrackerTelemetry({ battery: 15 }).batteryPercent).toBe(15);
  });

  it('normalise une tension de batterie interne en mV (>100) en pourcentage 0-100', () => {
    // 3.7V = 100% via la plage 3.0-4.2V ; 3000 mV = 0% ; 4200 mV = 100%.
    expect(extractTrackerTelemetry({ battery: 3700 }).batteryPercent).toBe(58);
    expect(extractTrackerTelemetry({ battery: 3000 }).batteryPercent).toBe(0);
    expect(extractTrackerTelemetry({ battery: 4200 }).batteryPercent).toBe(100);
  });

  it('parse ignition selon les formats booléen/numérique/string', () => {
    expect(extractTrackerTelemetry({ ignition: true }).ignition).toBe(true);
    expect(extractTrackerTelemetry({ ignition: false }).ignition).toBe(false);
    expect(extractTrackerTelemetry({ ignition: 1 }).ignition).toBe(true);
    expect(extractTrackerTelemetry({ ignition: 'true' }).ignition).toBe(true);
    expect(extractTrackerTelemetry({ ignition: 0 }).ignition).toBe(false);
  });

  it('ignore les valeurs non numériques de power/battery (pas de NaN en base)', () => {
    const t = extractTrackerTelemetry({ power: 'n/a', battery: 'inconnue' });
    expect(t.powerVolts).toBeNull();
    expect(t.batteryPercent).toBeNull();
  });
});

describe('tracker-telemetry — toJsonValue (stockage Prisma Json)', () => {
  it('renvoie null quand AUCUN champ n’est disponible (ne stocke jamais un objet vide)', () => {
    expect(toJsonValue({ powerVolts: null, batteryPercent: null, ignition: null })).toBeNull();
  });

  it('sérialise uniquement les champs disponibles', () => {
    expect(toJsonValue({ powerVolts: 12.4, batteryPercent: null, ignition: true })).toEqual({
      power: 12.4,
      ignition: true,
    });
    expect(toJsonValue({ powerVolts: null, batteryPercent: 15, ignition: null })).toEqual({
      battery: 15,
    });
  });
});

describe('tracker-telemetry — seuils d’alerte', () => {
  it('détecte une coupure électrique quand power ≤ seuil (0.5V)', () => {
    expect(isPowerCut({ powerVolts: 0 })).toBe(true);
    expect(isPowerCut({ powerVolts: 0.4 })).toBe(true);
    expect(isPowerCut({ powerVolts: 12 })).toBe(false);
    expect(isPowerCut({ powerVolts: null })).toBe(false);
    expect(POWER_CUT_VOLTS).toBe(0.5);
  });

  it('détecte une batterie interne critique quand battery ≤ 20% (exclut 0/non remonté)', () => {
    expect(isBatteryCritical({ batteryPercent: 15 })).toBe(true);
    expect(isBatteryCritical({ batteryPercent: 20 })).toBe(true);
    expect(isBatteryCritical({ batteryPercent: 21 })).toBe(false);
    expect(isBatteryCritical({ batteryPercent: 0 })).toBe(false);
    expect(isBatteryCritical({ batteryPercent: null })).toBe(false);
    expect(BATTERY_CRITICAL_PCT).toBe(20);
  });
});
