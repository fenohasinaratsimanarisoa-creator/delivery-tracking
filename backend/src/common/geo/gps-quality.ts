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
  let accuracy: number;
  let hdopInfo = '';

  if (deviceAccuracy !== undefined && deviceAccuracy === 0) {
    accuracy = 50;
    hdopInfo += 'device=0→50';
  } else if (deviceAccuracy !== undefined) {
    accuracy = deviceAccuracy;
    hdopInfo += `device=${deviceAccuracy}`;
  } else {
    accuracy = 50;
    hdopInfo += 'device=unset→50';
  }

  if (attributes?.hdop !== undefined) {
    const hdop = Number(attributes.hdop);
    if (!isNaN(hdop) && hdop > 0 && isFinite(hdop)) {
      if (hdop <= MAX_PLAUSIBLE_HDOP) {
        const fromHdop = Math.round(hdop * HDOP_UERE);
        hdopInfo += `, hdop=${hdop}→${fromHdop}m`;

        if (fromHdop > accuracy) {
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

  // Clamp final aligné sur le DTO (voir MAX_ACCURACY_M) : jamais d'accuracy > 1000.
  if (accuracy > MAX_ACCURACY_M) {
    accuracy = MAX_ACCURACY_M;
    hdopInfo += ' (clamp 1000)';
  }

  return { accuracy, hdopInfo };
}
