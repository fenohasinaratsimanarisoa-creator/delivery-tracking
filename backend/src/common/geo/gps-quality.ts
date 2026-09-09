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
