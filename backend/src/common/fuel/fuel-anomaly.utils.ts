// Dérivation en lecture de l'ancien champ unique anomalyFlag/anomalyReason.
// anomalyFlag et anomalyReason ne sont PLUS stockés en base : chaque détecteur
// écrit sa propre paire (consumptionAnomalyFlag/Reason ou gpsAnomalyFlag/Reason)
// et le champ composite est reconstruit ici, en lecture seule, pour préserver
// l'API (DTOs de réponse) et les consommateurs existants (digest, dashboard,
// rapports, frontend).

export interface FuelAnomalySource {
  consumptionAnomalyFlag?: boolean | null;
  gpsAnomalyFlag?: boolean | null;
  consumptionAnomalyReason?: string | null;
  gpsAnomalyReason?: string | null;
  // Paire dédiée à l'ABSENCE de couverture GPS sur la période du cross-check.
  // Volontairement EXCLUE de hasFuelAnomaly()/getFuelAnomalyReason() : un manque de
  // données GPS n'est pas une anomalie confirmée, c'est une absence de preuve — le
  // frontend doit pouvoir l'afficher différemment (« ❔ Non vérifiable » vs « ⚠️ Anomalie »).
  gpsCoverageInsufficientFlag?: boolean | null;
  gpsCoverageInsufficientReason?: string | null;
}

/** true si au moins l'un des deux détecteurs a signalé une anomalie confirmée. */
export function hasFuelAnomaly(log: FuelAnomalySource): boolean {
  return !!(log.consumptionAnomalyFlag || log.gpsAnomalyFlag);
}

/** Motif composite : les deux raisons sont concaténées si les deux détecteurs ont flaggé. */
export function getFuelAnomalyReason(log: FuelAnomalySource): string | null {
  const reasons = [log.consumptionAnomalyReason, log.gpsAnomalyReason].filter(
    (r): r is string => !!r,
  );
  return reasons.length > 0 ? reasons.join(' / ') : null;
}

/** Décore un FuelLog avec les champs dérivés anomalyFlag/anomalyReason (lecture seule). */
export function withDerivedAnomaly<T extends FuelAnomalySource>(
  log: T | null,
): (T & { anomalyFlag: boolean; anomalyReason: string | null }) | null {
  if (!log) return null;
  return {
    ...log,
    anomalyFlag: hasFuelAnomaly(log),
    anomalyReason: getFuelAnomalyReason(log),
  };
}
