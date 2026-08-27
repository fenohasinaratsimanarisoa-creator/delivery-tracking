// Seuil de bruit GPS : en dessous de 5m entre deux positions consécutives, on
// considère qu'il s'agit de bruit de réception (dérive à l'arrêt) et non d'un
// déplacement réel. SOURCE UNIQUE DE VÉRITÉ pour ce seuil : utilisé à la fois par
// generateDailyReportForDriver() (fuel-consumption.service.ts) et par
// calculateDistance()/calculateDistancePostGIS() (tracking.service.ts) afin que le
// rapport carburant et le rapport de trajet affichent la MÊME distance pour le
// même trajet. Ce seuil est cohérent avec le scale d'accuracy utilisé dans
// detectTeleportation (backend tracking.service.ts) où une accuracy de 10m donne
// un scale de 1.
export const GPS_NOISE_THRESHOLD_M = 5;

// Plafond de l'échelle d'accuracy appliquée au seuil de bruit (accuracy/10, plancher 1).
// Sans plafond, une précision dégradée (20-80m, fréquente en ville/centre-ville) élevait
// le seuil à 10-40 m et supprimait des segments RÉELS de circulation lente (10-30m entre
// deux fixes à INTERVAL_FAST=3s) — sous-corrigeant la distance d'un facteur 2 à 5 (ex.
// 50 km réels → ~10 km au rapport). Cap à 1.5 → le seuil ne dépasse jamais 7,5 m.
export const GPS_NOISE_MAX_ACCURACY_SCALE = 1.5;

// Vitesse (m/s) au-dessus de laquelle un segment est considéré comme un déplacement réel
// (toujours compté, quelle que soit sa longueur). 1.0 m/s ≈ 3.6 km/h : nettement au-dessus
// du bruit de vitesse d'un téléphone à l'arrêt, mais bien en dessous d'une progression
// réelle en circulation (embouteillage ≈ 2-5 m/s). C'est la RÈGLE VITESSE qui permet enfin
// de distinguer « dérive à l'arrêt » (vitesse≈0, petit segment) de « déplacement lent »
// (vitesse>0, petit segment) — la longueur seule ne pouvait pas.
export const MOVEMENT_SPEED_THRESHOLD_MS = 1.0;

// BUG CORRIGÉ (audit terrain 2026-08-27, confirmé sur données réelles en
// production) : la RÈGLE VITESSE ci-dessous comptait un segment en ENTIER dès
// qu'une vitesse > MOVEMENT_SPEED_THRESHOLD_MS était rapportée, SANS AUCUNE
// condition sur l'accuracy — alors qu'une vitesse GPS (Doppler/delta entre
// fixes) est elle-même dérivée du signal satellite et devient bruitée
// exactement quand l'accuracy se dégrade (multipath en intérieur, signal
// faible). Cas réel : chauffeur resté chez lui toute la nuit, téléphone
// immobile en intérieur — 2583 positions sur 7h38, accuracy moyenne 46 m
// (jusqu'à 451 m), 108 positions cumulant vitesse > seuil ET accuracy > 50 m.
// Chacune de ces positions faisait compter en entier son segment (parfois
// des dizaines de mètres de bruit de position pur), pour un total de 68,1 km
// « parcourus » alors que le véhicule n'a pas bougé. Un fix GPS dont
// l'accuracy dépasse ce plafond ne peut plus authentifier un déplacement :
// on retombe alors sur la RÈGLE SEUIL (bruit filtré, plafonnée) au lieu de
// faire confiance à sa vitesse.
export const MOVEMENT_TRUST_MAX_ACCURACY_M = 30;

// FENÊTRE D'ARRÊT (audit terrain 2026-08-27, complément du garde-fou ci-dessus) :
// la sommation PAIRWISE (segment à segment) accumule TOUJOURS un peu de dérive
// GPS à l'arrêt, même après les deux correctifs déjà appliqués — chaque
// micro-segment individuellement plausible finit par s'additionner sur des
// heures. Repli conservateur : si une SUITE de positions reste entièrement
// dans un rayon de STATIONARY_RADIUS_M pendant au moins
// STATIONARY_MIN_DURATION_S, elle est traitée comme un arrêt UNIQUE (un seul
// point représentatif, aucune distance accumulée à l'intérieur) plutôt que
// comme une série de micro-déplacements.
//
// Rayon volontairement MODESTE (30m, sous les segments réels ~22m des tests de
// circulation lente en ville visés par la RÈGLE VITESSE) : un rayon plus large
// (vérifié empiriquement sur un cas réel de dérive GPS extrême, ~800m
// nécessaires pour l'annuler entièrement) effacerait aussi de VRAIS trajets
// courts ailleurs dans la flotte. Cette fenêtre aide donc le cas COURANT
// (dérive indoor/parking modérée, quelques dizaines de mètres) ; les nuits à
// dérive extrême restent signalées séparément via gpsDataQuality='suspicious'
// (voir upsertDailyReportForVehicleGroup, fuel-consumption.service.ts) plutôt
// que « corrigées » par un rayon trop large pour être sûr.
export const STATIONARY_RADIUS_M = 30;
export const STATIONARY_MIN_DURATION_S = 300;

// BUG CORRIGÉ (première version de cette fenêtre, audit terrain 2026-08-27) :
// sans garde-fou sur la densité d'échantillonnage, une progression RÉELLE mais
// échantillonnée peu fréquemment (ex. un fix par heure — scénario testé dans
// "Non-régression (b)") se faisait collapser à tort : deux fixes espacés d'1h
// mais à seulement 22m l'un de l'autre ressemblent, sur le seul critère
// rayon+durée, à un arrêt de longue durée. Repris du seuil DÉJÀ établi ailleurs
// dans ce fichier pour signaler une couverture GPS clairsemée (voir
// upsertDailyReportForVehicleGroup, "avgGapSec > 60") : un arrêt n'est confirmé
// que si l'échantillonnage reste dense (chaque fix à ≤ 60s du précédent) sur
// TOUTE la fenêtre — une progression réelle mais rarement échantillonnée n'est
// alors JAMAIS assez "dense" pour être confondue avec un arrêt.
export const STATIONARY_MAX_SAMPLE_GAP_S = 60;

/**
 * Réduit une suite de positions en collapsant les fenêtres d'ARRÊT CONFIRMÉ
 * (voir STATIONARY_RADIUS_M / STATIONARY_MIN_DURATION_S / STATIONARY_MAX_SAMPLE_GAP_S)
 * à un seul point représentatif chacune. No-op silencieux si un timestamp
 * manque (repli sûr : computeFilteredDistance() retombe alors sur son
 * comportement pairwise habituel, inchangé).
 */
export function collapseStationaryWindows<
  T extends { latitude: number; longitude: number; timestamp?: Date | null },
>(positions: T[]): T[] {
  if (positions.length < 3 || positions.some((p) => !p.timestamp)) return positions;

  const out: T[] = [];
  let i = 0;
  const n = positions.length;
  while (i < n) {
    let j = i + 1;
    while (j < n) {
      const gapS =
        (positions[j].timestamp!.getTime() - positions[j - 1].timestamp!.getTime()) / 1000;
      if (gapS > STATIONARY_MAX_SAMPLE_GAP_S) break;
      if (
        haversineDistance(
          positions[i].latitude,
          positions[i].longitude,
          positions[j].latitude,
          positions[j].longitude,
        ) > STATIONARY_RADIUS_M
      ) {
        break;
      }
      j++;
    }
    const windowEnd = j - 1;
    const durationS =
      (positions[windowEnd].timestamp!.getTime() - positions[i].timestamp!.getTime()) / 1000;
    if (windowEnd > i && durationS >= STATIONARY_MIN_DURATION_S) {
      // Arrêt confirmé : un seul point représentatif (le dernier de la fenêtre,
      // pour préserver la continuité chronologique avec ce qui suit).
      out.push(positions[windowEnd]);
      i = windowEnd + 1;
    } else {
      out.push(positions[i]);
      i++;
    }
  }
  return out;
}

/**
 * Distance cumulée d'un trajet en filtrant le bruit GPS, avec un seuil pondéré par
 * l'accuracy moyenne de chaque segment ET plafonné (GPS_NOISE_MAX_ACCURACY_SCALE).
 *
 * SOURCE UNIQUE DE VÉRITÉ pour le calcul de distance filtrée : utilisé à la fois par
 * generateDailyReportForDriver()/upsertDailyReportForVehicleGroup() (fuel-consumption) et
 * par calculateDistance() (tracking) afin que le rapport carburant et le rapport de trajet
 * restent cohérents pour le même (véhicule, jour).
 *
 * RÈGLE VITESSE (corrige le sous-comptage massif) : si l'une des deux extrémités d'un
 * segment est en mouvement (speed > MOVEMENT_SPEED_THRESHOLD_MS) ET que sa position est
 * suffisamment précise (accuracy ≤ MOVEMENT_TRUST_MAX_ACCURACY_M), le segment est TOUJOURS
 * compté, même sous le seuil de distance. L'ancienne logique (seuil 5m × max(1, accuracy/10)
 * SANS plafond) supprimait les segments courts des trajets urbains lents — un véhicule à
 * 10-30 km/h couvre 8-25 m en 3 s, sous les thresholds 15-40 m induits par une accuracy
 * dégradée. La vitesse authentifie le déplacement : elle est fournie par le mobile
 * (coords.speed) et par Traccar (noeuds → m/s) et stockée dans gps_positions.speed.
 *
 * RÈGLE SEUIL (conservée pour l'arrêt) : sans vitesse (ou vitesse≈0 → véhicule à l'arrêt),
 * on filtre le bruit de dérive avec le seuil pondéré par l'accuracy, plafonné à
 * GPS_NOISE_MAX_ACCURACY_SCALE (→ max 7,5 m) pour ne jamais effacer un réel court trajet.
 *
 * FENÊTRE D'ARRÊT (pré-passe, voir collapseStationaryWindows) : appliquée AVANT le calcul
 * pairwise ci-dessus, uniquement si tous les timestamps sont présents.
 *
 * DÉVIATION ASSUMÉE vs calculateDistancePostGIS : celui-ci garde un seuil FIXE à 5m (aucune
 * pondération accuracy) — acceptable, car le PostGIS ne sert qu'au rapport de trajet
 * complémentaire, pas au rapport carburant.
 */
export function computeFilteredDistance(
  positions: Array<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    speed?: number | null;
    timestamp?: Date | null;
  }>,
): number {
  positions = collapseStationaryWindows(positions);
  let totalDistance = 0;
  for (let i = 1; i < positions.length; i++) {
    const p1 = positions[i - 1];
    const p2 = positions[i];
    const segDist = haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);

    // RÈGLE VITESSE : un déplacement avéré est compté intégralement — mais
    // UNIQUEMENT si la position qui rapporte cette vitesse est elle-même
    // suffisamment précise (accuracy ≤ MOVEMENT_TRUST_MAX_ACCURACY_M) pour
    // que sa vitesse soit exploitable. Voir le commentaire de la constante :
    // sans ce garde-fou, du bruit GPS indoor/stationnaire pouvait gonfler la
    // distance de dizaines de km sans aucun déplacement réel.
    const moving =
      (p1.speed != null &&
        p1.speed > MOVEMENT_SPEED_THRESHOLD_MS &&
        (p1.accuracy == null || p1.accuracy <= MOVEMENT_TRUST_MAX_ACCURACY_M)) ||
      (p2.speed != null &&
        p2.speed > MOVEMENT_SPEED_THRESHOLD_MS &&
        (p2.accuracy == null || p2.accuracy <= MOVEMENT_TRUST_MAX_ACCURACY_M));
    if (moving) {
      totalDistance += segDist;
      continue;
    }

    // Pas de déplacement (arrêt ou vitesse inconnue) : filtre la dérive avec le seuil.
    const avgAccuracy =
      p1.accuracy != null && p2.accuracy != null
        ? (p1.accuracy + p2.accuracy) / 2
        : (p1.accuracy ?? p2.accuracy ?? 0);
    const scale =
      avgAccuracy > 0 ? Math.max(1, Math.min(avgAccuracy / 10, GPS_NOISE_MAX_ACCURACY_SCALE)) : 1;
    const threshold = GPS_NOISE_THRESHOLD_M * scale;
    if (segDist >= threshold) {
      totalDistance += segDist;
    }
  }
  return totalDistance;
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
