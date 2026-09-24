const HDOP_UERE = 5;

// Plafond plausible d'un HDOP GPS réel : les valeurs typiques vont de 0,5 (excellent) à
// ~10 (urbain dense / canyon). Certains traceurs bas de gamme renvoient dans `hdop` une
// valeur non standard (puissance de signal, compteur, unité différente) qui peut atteindre
// 100-1000 — l'interpréter comme un vrai HDOP gonflerait l'accuracy dérivée jusqu'à rejeter
// la position par la validation DTO (accuracy @Max(1000)). Au-delà de 50, la valeur n'est
// PAS un HDOP exploitable : on l'ignore (repli sur l'accuracy device/50).
const MAX_PLAUSIBLE_HDOP = 50;

// Plafond d'accuracy retournée, ALIGNÉ sur UpdatePositionDto.accuracy @Max(1000) : sans ce
// clamp, une accuracy dérivée > 1000 (device ou hdop aberrant) faisait REJETER la position
// par validateSync() dans handlePosition — un traceur inconnu perdait silencieusement ses
// positions. La position est conservée avec accuracy=1000 (confiance minimale), jamais
// rejetée pour cette raison.
const MAX_ACCURACY_M = 1000;

// Accuracy par défaut quand AUCUN indicateur de qualité n'est disponible (ni accuracy
// device, ni HDOP, ni compte de satellites). Valeur historique, conservée.
const DEFAULT_ACCURACY_M = 50;

/**
 * Estimation d'accuracy (m) à partir du NOMBRE DE SATELLITES suivis (`attributes.sat`).
 *
 * De nombreux traceurs bas de gamme (GT06 & co) ne remontent NI `accuracy` NI `hdop`,
 * mais remontent `sat`. Sur trace réelle de production (Antananarivo, device
 * 869890085158149), l'erreur de position est fortement corrélée au compte de satellites :
 * les fixes à 14-15 sat sont groupés à ~10 m, ceux à 5-7 sat dérivent de 45-55 m.
 *
 * Barème VOLONTAIREMENT PRUDENT (borne haute de l'erreur observée par palier) — il ne
 * sert qu'à remplacer la constante inventée de 50 m par une valeur qui reflète la réalité,
 * et il est toujours combiné en `max()` avec l'accuracy device / HDOP quand elles existent.
 * `null` si `sat` absent ou aberrant → l'appelant garde son estimation existante.
 */
export function accuracyFromSatellites(sat: unknown): number | null {
  const n = Number(sat);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 12) return 8;
  if (n >= 10) return 12;
  if (n >= 8) return 20;
  if (n === 7) return 35;
  if (n === 6) return 55;
  if (n === 5) return 90;
  return 150; // <= 4 satellites : fix à peine exploitable
}

export function computeConfidence(
  accuracy: number | undefined,
  suspect: boolean,
  speed?: number,
  _heading?: number,
): number {
  let score = 100;

  if (accuracy !== undefined && accuracy > 0) {
    if (accuracy <= 5) score -= 5;
    else if (accuracy <= 10) score -= 10;
    else if (accuracy <= 20) score -= 20;
    else if (accuracy <= 50) score -= 40;
    else score -= 60;
  } else {
    score -= 30;
  }

  if (suspect) score -= 50;

  if (speed !== undefined && speed < 0.1) score = Math.min(score, 70);

  return Math.max(0, Math.min(100, score));
}

export function computeCombinedAccuracy(
  deviceAccuracy: number | undefined,
  attributes: Record<string, unknown> | undefined,
): { accuracy: number; hdopInfo: string } {
  // `accuracy` reste undefined tant qu'aucun indicateur exploitable n'a été vu ;
  // on ne retombe sur DEFAULT_ACCURACY_M qu'en tout dernier recours.
  let accuracy: number | undefined;
  let hdopInfo = '';

  if (deviceAccuracy !== undefined && deviceAccuracy > 0) {
    accuracy = deviceAccuracy;
    hdopInfo += `device=${deviceAccuracy}`;
  } else if (deviceAccuracy === 0) {
    hdopInfo += 'device=0';
  } else {
    hdopInfo += 'device=unset';
  }

  if (attributes?.hdop !== undefined) {
    const hdop = Number(attributes.hdop);
    if (!isNaN(hdop) && hdop > 0 && isFinite(hdop)) {
      if (hdop <= MAX_PLAUSIBLE_HDOP) {
        const fromHdop = Math.round(hdop * HDOP_UERE);
        hdopInfo += `, hdop=${hdop}→${fromHdop}m`;

        if (accuracy === undefined || fromHdop > accuracy) {
          accuracy = fromHdop;
          hdopInfo += ' (retenu)';
        } else {
          hdopInfo += ' (device plus precis)';
        }
      } else {
        hdopInfo += `, hdop=${hdop} hors plage plausible (ignoré)`;
      }
    }
  }

  // Nombre de satellites : dernier indicateur, exploité quand ni accuracy device ni
  // HDOP ne sont disponibles (cas des GT06). Toujours combiné en `max()` (le plus
  // prudent l'emporte).
  const satAccuracy = accuracyFromSatellites(attributes?.sat);
  if (satAccuracy !== null) {
    hdopInfo += `, sat=${Number(attributes?.sat)}→${satAccuracy}m`;
    if (accuracy === undefined || satAccuracy > accuracy) {
      accuracy = satAccuracy;
      hdopInfo += ' (retenu)';
    } else {
      hdopInfo += ' (autre source plus précise)';
    }
  }

  if (accuracy === undefined) {
    accuracy = DEFAULT_ACCURACY_M;
    hdopInfo += ` → ${DEFAULT_ACCURACY_M} (défaut)`;
  }

  // Clamp final aligné sur le DTO (voir MAX_ACCURACY_M) : jamais d'accuracy > 1000.
  if (accuracy > MAX_ACCURACY_M) {
    accuracy = MAX_ACCURACY_M;
    hdopInfo += ' (clamp 1000)';
  }

  return { accuracy, hdopInfo };
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX DE RÉVEIL PEU FIABLE (audit « téléportation » 2026-09-20).
//
// Un GT06 motion-triggered dort à l'arrêt. À son réveil, son premier fix est calculé
// avant que le GPS ait convergé : 5-9 satellites au lieu de 15, et une erreur qui a
// atteint ~430 m (fix de 15:53:03/08 UTC : 7 satellites, `accuracy` déduite 35 m, alors
// que le véhicule n'avait pas bougé). Le serveur l'acceptait dès 4 satellites, le
// stockait, le comptait comme un déplacement (« un trajet que je n'ai pas fait ») et
// l'AFFICHAIT : le 2e fix faux, à côté du 1er, était « corroboré » par l'ancre d'arrêt.
// Historique 45 jours : 99 % des fixes ont ≥ 12 satellites ; les rares fixes < 10 arrivent
// presque tous juste après une longue veille (écart de plusieurs heures avant).
//
// Règle : après un silence > WAKE_SILENCE_MIN_S, un fix à moins de WAKE_TRUST_MIN_SAT
// satellites est mis en QUARANTAINE (ni stocké, ni affiché, ni compté). Elle se lève dès
// qu'un fix fiable arrive (cas normal : il est alors accepté tel quel, même s'il est
// loin — le véhicule a pu réellement bouger pendant la veille), ou après
// WAKE_QUARANTINE_MAX_S de fixes faibles seuls (ciel limité : jamais de traceur bloqué).
//
// Une quarantaine dont le dernier fix faible date de plus de WAKE_QUARANTINE_STALE_S est
// PÉRIMÉE (le traceur s'est rendormi avant d'envoyer un fix fiable) : le fix suivant
// ouvre un NOUVEL épisode. Sans cette règle (audit trajet 2026-09-22), la quarantaine
// restée ouverte depuis la veille (21/09 15:14 UTC) paraissait durer depuis 12 h au
// réveil suivant et était levée d'office : 8 fixes à 7-8 satellites stockés, faux trajet
// de ~800 m à 112 km/h et +3 km dans le rapport carburant du jour.
// ─────────────────────────────────────────────────────────────────────────────

/** En dessous, un fix qui suit un long silence n'est pas fiable (GPS pas convergé). */
export const WAKE_TRUST_MIN_SAT = 10;
/** Silence (s) au-delà duquel un fix est un fix de « réveil ». */
export const WAKE_SILENCE_MIN_S = 120;
/** Durée max (s) pendant laquelle des fixes faibles restent en quarantaine. */
export const WAKE_QUARANTINE_MAX_S = 120;
/**
 * Silence (s) après lequel une quarantaine encore ouverte est périmée (nouvel épisode).
 * Bien au-delà de WAKE_QUARANTINE_MAX_S : un traceur qui n'envoie que des fixes faibles
 * espacés de quelques minutes finit toujours libéré (jamais de traceur bloqué).
 */
export const WAKE_QUARANTINE_STALE_S = 600;

export interface WakeFixInput {
  /** `attributes.sat` du fix (inconnu/absent → jamais considéré faible). */
  sat: unknown;
  /** Secondes depuis le dernier fix STOCKÉ du véhicule ; null s'il n'y en a aucun. */
  gapSincePrevSec: number | null;
  /** Horodatage (ms) du début de la quarantaine en cours pour ce véhicule, sinon null. */
  quarantineSinceMs: number | null;
  /** Horodatage (ms) du dernier fix mis en quarantaine (absent → quarantineSinceMs). */
  quarantineLastMs?: number | null;
  /** Horodatage (ms) du fix évalué. */
  fixTimeMs: number;
}

export interface WakeFixVerdict {
  /** true → ne PAS stocker ni diffuser ce fix. */
  quarantine: boolean;
  /** Nouvel état de quarantaine à mémoriser pour ce véhicule (null = aucune). */
  quarantineSinceMs: number | null;
  /** Dernier fix mis en quarantaine, à mémoriser avec quarantineSinceMs (null = aucune). */
  quarantineLastMs: number | null;
}

export function evaluateWakeFix(input: WakeFixInput): WakeFixVerdict {
  const NONE: WakeFixVerdict = {
    quarantine: false,
    quarantineSinceMs: null,
    quarantineLastMs: null,
  };
  const satN = Number(input.sat);
  const weak = input.sat != null && Number.isFinite(satN) && satN > 0 && satN < WAKE_TRUST_MIN_SAT;
  // Fix fiable (ou sans information de satellites) : met fin à toute quarantaine.
  if (!weak) return NONE;

  if (input.quarantineSinceMs != null) {
    const lastMs = Math.max(
      input.quarantineLastMs ?? input.quarantineSinceMs,
      input.quarantineSinceMs,
    );
    const stale = (input.fixTimeMs - lastMs) / 1000 > WAKE_QUARANTINE_STALE_S;
    if (!stale) {
      const elapsedS = (input.fixTimeMs - input.quarantineSinceMs) / 1000;
      if (elapsedS >= WAKE_QUARANTINE_MAX_S) return NONE;
      return {
        quarantine: true,
        quarantineSinceMs: input.quarantineSinceMs,
        quarantineLastMs: Math.max(lastMs, input.fixTimeMs),
      };
    }
    // Quarantaine périmée : on évalue ce fix comme un nouveau réveil (ci-dessous).
  }

  const afterSilence = input.gapSincePrevSec == null || input.gapSincePrevSec > WAKE_SILENCE_MIN_S;
  if (!afterSilence) return NONE; // trajet continu
  return {
    quarantine: true,
    quarantineSinceMs: input.fixTimeMs,
    quarantineLastMs: input.fixTimeMs,
  };
}
