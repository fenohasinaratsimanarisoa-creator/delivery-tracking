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
// CONSERVÉ pour compatibilité (calculateDistancePostGIS, tests hérités) mais n'est
// PLUS utilisé par computeFilteredDistance depuis l'audit du 2026-08-28 — voir plus bas.
export const GPS_NOISE_MAX_ACCURACY_SCALE = 1.5;

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TERRAIN 2026-08-28 — sur-comptage confirmé sur trace réelle de production.
//
// Cas : trajet aller-retour (déplacement net = 0, le chauffeur rentre chez lui),
// zone parcourue ~16 km de diagonale. Distance RÉELLE estimée ~40 km. Rapport
// carburant : 87 km. Reconstruction segment par segment de la trace (6169 fixes,
// 15 h) :
//   - 2512 segments à accuracy < 20 m totalisent ~43 km  → majoritairement RÉEL ;
//   - 399  segments à accuracy > 80 m totalisent ~33 km  → BRUIT DE RÉCEPTION PUR,
//     comptés intégralement par l'ancien algo.
//
// CAUSE : l'ancien seuil de bruit était plafonné à 7,5 m (GPS_NOISE_MAX_ACCURACY_SCALE).
// À accuracy 50-600 m, la position réelle est incertaine de dizaines à centaines
// de mètres — chaque « saut » de bruit dépasse donc 7,5 m et était compté comme
// un déplacement. Et la RÈGLE VITESSE comptait le segment ENTIER même quand le
// saut de position (jitter) était bien plus grand que ce que la vitesse permet.
//
// NOUVELLE LOGIQUE (bornée par des données réelles — ramène 87→49 km et 125→43 km
// sur deux journées, sans toucher un trajet propre synthétique de 20 km) :
//   1. Si les DEUX fixes d'un segment ont accuracy > GPS_UNUSABLE_ACCURACY_M, ni
//      la position ni la vitesse Doppler ne peuvent authentifier un déplacement :
//      segment ignoré.
//   2. Vitesse Doppler exploitable (accuracy ≤ SPEED_TRUST_MAX_ACCURACY_M) et
//      > seuil → déplacement réel, mais BORNÉ par vitesse × Δt × marge : un saut
//      de position plus grand que ça est du jitter, pas de la distance.
//   3. Sinon, le segment ne compte que s'il dépasse NETTEMENT le bruit combiné
//      des deux fixes : GPS_NOISE_SIGMA_K × rms(accuracy1, accuracy2).
// ─────────────────────────────────────────────────────────────────────────────

/** Accuracy supposée quand un fix n'en fournit pas (certains protocoles Traccar). */
export const GPS_ACCURACY_FALLBACK_M = 25;

/** Au-delà (sur les DEUX extrémités d'un segment), le fix n'authentifie plus rien. */
export const GPS_UNUSABLE_ACCURACY_M = 80;

/** Un segment ne compte que si sa longueur dépasse K × l'incertitude combinée. */
export const GPS_NOISE_SIGMA_K = 2;

/** Plancher du seuil de bruit — sous ça, c'est toujours de la dérive. */
export const GPS_NOISE_FLOOR_M = 4;

/**
 * Accuracy max pour faire CONFIANCE à la vitesse Doppler rapportée par le device
 * dans le calcul de distance. Plus permissif que MOVEMENT_TRUST_MAX_ACCURACY_M
 * (30 m, qui garde la DÉRIVATION haversine/Δt) : ici la distance est de toute
 * façon BORNÉE par vitesse × Δt × marge, donc la valeur exacte de ce seuil est
 * peu sensible (testé sur trace réelle : 48,9 km identique pour un seuil de 50
 * à 80). 70 m couvre l'embouteillage en centre-ville dense (accuracy 50-70 m,
 * vitesse Doppler encore fiable) sans jamais laisser passer du bruit (le cap
 * vitesse × Δt s'en charge).
 */
export const SPEED_TRUST_MAX_ACCURACY_M = 70;

/** Un segment « en mouvement » ne peut pas dépasser vitesse × Δt × cette marge. */
export const SPEED_DISTANCE_CAP_MULT = 1.5;

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
 * Une accuracy est « digne de confiance » pour AUTHENTIFIER un déplacement si
 * elle est absente (source qui n'en fournit pas, ex. certains protocoles
 * Traccar — on ne pénalise pas) ou inférieure au plafond de confiance.
 *
 * Source unique de vérité, partagée par :
 *  - computeFilteredDistance (RÈGLE VITESSE, ci-dessous) ;
 *  - TrackingService.saveBatch / TrackingGateway.handlePosition, qui ne
 *    DÉRIVENT une vitesse (haversine/Δt) que si les deux extrémités sont
 *    fiables — sinon la vitesse dérivée du bruit validerait son propre segment
 *    de bruit (audit GPS 2026-08-28, C8).
 */
export function isAccuracyTrustworthy(accuracy?: number | null): boolean {
  return accuracy == null || accuracy <= MOVEMENT_TRUST_MAX_ACCURACY_M;
}

/**
 * Réduit une suite de positions en collapsant les fenêtres d'ARRÊT CONFIRMÉ
 * (voir STATIONARY_RADIUS_M / STATIONARY_MIN_DURATION_S / STATIONARY_MAX_SAMPLE_GAP_S)
 * à un seul point représentatif chacune. No-op silencieux si un timestamp
 * manque (repli sûr : computeFilteredDistance() retombe alors sur son
 * comportement pairwise habituel, inchangé).
 */
export function collapseStationaryWindows<
  T extends {
    latitude: number;
    longitude: number;
    timestamp?: Date | null;
    speed?: number | null;
    accuracy?: number | null;
  },
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
      // BUG CORRIGÉ (audit GPS 2026-08-28, C9) : une fenêtre était collapsée sur
      // le seul critère rayon+durée+densité, ce qui effaçait de VRAIS
      // déplacements confinés (manœuvres répétées en dépôt, deux-roues circulant
      // dans un marché, livraison en zone piétonne) — du carburant réellement
      // consommé disparaissait du rapport. Une position qui rapporte une vitesse
      // RÉELLE et FIABLE prouve un déplacement : elle interrompt la fenêtre
      // d'arrêt, qui redevient ce qu'elle doit être — un arrêt.
      const movingHere =
        positions[j].speed != null &&
        positions[j].speed! > MOVEMENT_SPEED_THRESHOLD_MS &&
        isAccuracyTrustworthy(positions[j].accuracy);
      if (movingHere) break;
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

    const a1 = p1.accuracy != null && p1.accuracy > 0 ? p1.accuracy : GPS_ACCURACY_FALLBACK_M;
    const a2 = p2.accuracy != null && p2.accuracy > 0 ? p2.accuracy : GPS_ACCURACY_FALLBACK_M;

    // (1) Les DEUX fixes trop imprécis : segment = bruit, jamais compté.
    if (a1 > GPS_UNUSABLE_ACCURACY_M && a2 > GPS_UNUSABLE_ACCURACY_M) {
      continue;
    }

    // Δt du segment (secondes). Absent (appelant sans timestamps, ex. tests
    // hérités) → on ne peut pas borner par la vitesse, repli documenté ci-dessous.
    const dtSec =
      p1.timestamp instanceof Date && p2.timestamp instanceof Date
        ? Math.max(1, (p2.timestamp.getTime() - p1.timestamp.getTime()) / 1000)
        : null;

    // (2) RÈGLE VITESSE : la vitesse Doppler du device (≤ SPEED_TRUST_MAX_ACCURACY_M)
    // atteste un déplacement réel — mais la distance retenue est BORNÉE par ce que
    // la vitesse permet physiquement (vitesse × Δt × marge). Un saut de position
    // plus grand est du jitter GPS pendant le trajet, pas de la distance parcourue.
    const speedTrusted = (acc: number, spd: number | null | undefined) =>
      acc <= SPEED_TRUST_MAX_ACCURACY_M && spd != null && spd > MOVEMENT_SPEED_THRESHOLD_MS;
    const moving = speedTrusted(a1, p1.speed) || speedTrusted(a2, p2.speed);
    if (moving) {
      const maxSpeed = Math.max(p1.speed ?? 0, p2.speed ?? 0);
      totalDistance +=
        dtSec != null ? Math.min(segDist, maxSpeed * dtSec * SPEED_DISTANCE_CAP_MULT) : segDist;
      continue;
    }

    // (3) Ni vitesse fiable ni arrêt : le segment ne compte que s'il dépasse
    // NETTEMENT le bruit de position combiné des deux fixes.
    // rms = hypot(a1, a2) / √2 ≈ « incertitude typique » du segment.
    const noiseGate = Math.max(
      GPS_NOISE_FLOOR_M,
      (GPS_NOISE_SIGMA_K * Math.hypot(a1, a2)) / Math.SQRT2,
    );
    if (segDist >= noiseGate) {
      totalDistance += segDist;
    }
  }
  return totalDistance;
}

// Seuils du détecteur de BRUIT GPS STATIONNAIRE (voir isStationaryNoise).
// Volontairement conservateurs pour ne jamais flaguer à tort une vraie tournée
// de livraison à arrêts multiples (ratio de vagabondage naturellement élevé,
// mais accuracy correcte).
export const WANDER_RATIO_THRESHOLD = 4;
export const WANDER_MIN_AVG_ACCURACY_M = 35;
export const WANDER_MIN_DISTANCE_KM = 3;

/**
 * Détecte une distance produite par du BRUIT GPS STATIONNAIRE plutôt que par un
 * trajet réel, à partir de deux signaux convergents :
 *  - le déplacement NET (premier → dernier point) est minuscule comparé à la
 *    distance cumulée (aller-retours sans progression réelle — signature de la
 *    dérive, pas d'une tournée qui progresse globalement) ;
 *  - l'accuracy moyenne de la période est dégradée (signal faible).
 *
 * Cas réel à l'origine de ce détecteur : 68 km « parcourus » par un véhicule
 * resté immobile toute la nuit (accuracy moyenne ~67 m).
 *
 * SOURCE UNIQUE DE VÉRITÉ (audit GPS/carburant 2026-08-28, C4) : ce verdict
 * était auparavant codé en dur dans upsertDailyReportForVehicleGroup et ne
 * s'appliquait donc QU'au DailyFuelReport. crossCheckFuelLogWithGps recalculait
 * sa propre distance sans ce garde-fou : le bruit stationnaire gonflait `gpsKm`,
 * le ratio manuel/GPS baissait, et une VRAIE sur-déclaration passait inaperçue —
 * exactement l'inverse du faux positif que le détecteur corrige côté rapport.
 * Les deux consommateurs de la même donnée partagent désormais le même verdict.
 */
export function isStationaryNoise(params: {
  distanceKm: number;
  netDisplacementKm: number;
  avgAccuracy: number;
}): boolean {
  const { distanceKm, netDisplacementKm, avgAccuracy } = params;
  if (distanceKm < WANDER_MIN_DISTANCE_KM) return false;
  const wanderRatio = netDisplacementKm > 0 ? distanceKm / netDisplacementKm : Infinity;
  return wanderRatio > WANDER_RATIO_THRESHOLD && avgAccuracy > WANDER_MIN_AVG_ACCURACY_M;
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
