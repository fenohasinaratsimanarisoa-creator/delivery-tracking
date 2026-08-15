/**
 * Télémétrie matériel des traceurs GPS physiques (via l'objet Position normalisé
 * de Traccar). Traitée de façon PROTOCOLE-AGNOSTIQUE : chaque champ est
 * potentiellement absent selon le modèle (GT06 bas de gamme vs Teltonika haut de
 * gamme), et les unités peuvent varier (power en volts ou millivolts selon le
 * protocole).
 *
 * Le but n'est PAS de deviner une valeur exacte, mais de distinguer, pour un
 * silence GPS prolongé, les CAUSES PROBABLES : coupure électrique du véhicule
 * (power → 0) vs batterie interne du traceur critique (battery → faible) vs
 * panne SIM/matériel (dernière télémétrie normale, silence brutal).
 */

export interface TrackerTelemetry {
  /** Tension d'alimentation (volts). null si le protocole ne la remonte pas. */
  powerVolts: number | null;
  /** Niveau batterie interne du traceur (0-100). null si non remonté. */
  batteryPercent: number | null;
  /** État du contact véhicule. null si non remonté. */
  ignition: boolean | null;
}

/**
 * Extrait la télémétrie d'un objet attributes Traccar. Absence totale du champ
 * (modèle bas de gamme) → null, jamais une valeur inventée. `power` peut être
 * exprimé en volts (~12) ou millivolts (~12000) selon le protocole : au-dessus
 * de 50 on interprète en millivolts (÷1000), sinon on garde la valeur brute.
 * `battery` peut être un pourcentage (0-100) ou une tension de batterie interne
 * en mV (~3.7-4.2) : au-dessus de 100 on interprète en millivolts (÷1000 × 100%
 * via une plage 3.0-4.2V), sinon pourcentage.
 */
export function extractTrackerTelemetry(
  attributes: Record<string, unknown> | undefined | null,
): TrackerTelemetry {
  if (!attributes || typeof attributes !== 'object') {
    return { powerVolts: null, batteryPercent: null, ignition: null };
  }

  const power = parseFinite(attributes.power, attributes.powerVoltage, attributes.voltage);
  const battery = parseFinite(
    attributes.battery,
    attributes.batteryLevel,
    attributes.batteryLevelPct,
  );
  const ignitionRaw = attributes.ignition;

  let powerVolts: number | null = null;
  if (power !== null) {
    powerVolts = power > 50 ? round2(power / 1000) : round2(power);
  }

  let batteryPercent: number | null = null;
  if (battery !== null) {
    if (battery > 100) {
      // Tension de batterie interne (mV) : plage typique 3000-4200 mV → 0-100%.
      batteryPercent = Math.max(0, Math.min(100, Math.round(((battery / 1000 - 3.0) / 1.2) * 100)));
    } else {
      batteryPercent = Math.max(0, Math.min(100, Math.round(battery)));
    }
  }

  let ignition: boolean | null = null;
  if (ignitionRaw !== undefined && ignitionRaw !== null) {
    ignition =
      ignitionRaw === true || ignitionRaw === 1 || ignitionRaw === '1' || ignitionRaw === 'true';
  }

  return { powerVolts, batteryPercent, ignition };
}

/** Sérialisation JSON sûre pour le stockage Prisma (Json). */
export function toJsonValue(t: TrackerTelemetry): Record<string, unknown> | null {
  if (t.powerVolts === null && t.batteryPercent === null && t.ignition === null) {
    return null;
  }
  const out: Record<string, unknown> = {};
  if (t.powerVolts !== null) out.power = t.powerVolts;
  if (t.batteryPercent !== null) out.battery = t.batteryPercent;
  if (t.ignition !== null) out.ignition = t.ignition;
  return out;
}

/** Seuil de tension sous lequel on considère une coupure électrique du véhicule. */
export const POWER_CUT_VOLTS = 0.5;
/** Seuil de batterie interne du traceur sous lequel il va bientôt cesser d'émettre. */
export const BATTERY_CRITICAL_PCT = 20;

export function isPowerCut(telemetry: {
  powerVolts: number | null;
  batteryPercent?: number | null;
  ignition?: boolean | null;
}): boolean {
  return telemetry.powerVolts !== null && telemetry.powerVolts <= POWER_CUT_VOLTS;
}

export function isBatteryCritical(telemetry: {
  batteryPercent: number | null;
  powerVolts?: number | null;
  ignition?: boolean | null;
}): boolean {
  return (
    telemetry.batteryPercent !== null &&
    telemetry.batteryPercent > 0 &&
    telemetry.batteryPercent <= BATTERY_CRITICAL_PCT
  );
}

function parseFinite(...values: unknown[]): number | null {
  for (const v of values) {
    if (v === undefined || v === null) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
