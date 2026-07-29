const HDOP_UERE = 5;

export function computeConfidence(
  accuracy: number | undefined,
  suspect: boolean,
  speed?: number,
  heading?: number,
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
      const fromHdop = Math.round(hdop * HDOP_UERE);
      hdopInfo += `, hdop=${hdop}→${fromHdop}m`;

      if (fromHdop > accuracy) {
        accuracy = fromHdop;
        hdopInfo += ' (retenu)';
      } else {
        hdopInfo += ' (device plus precis)';
      }
    }
  }

  return { accuracy, hdopInfo };
}
