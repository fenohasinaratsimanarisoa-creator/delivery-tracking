/**
 * Timing d'animation des marqueurs (RealTimeMap AnimatedMarker).
 *
 * La durée d'interpolation doit correspondre au délai RÉEL entre deux positions
 * reçues (timestamp à timestamp) : si le véhicule émet toutes les 3s, le marqueur
 * glisse pendant ~3s à la vitesse réelle du véhicule (rendu type Google Maps).
 * Une durée fixe (~600ms) « rattrapait » artificiellement la distance en début
 * d'intervalle puis restait figée — visuellement saccadée et infidèle à la
 * vitesse réelle, surtout à cadence variable (natif vs JS vs reconnexion).
 */

/** Durée max d'animation. Couvre la cadence d'un traceur physique
 * « motion-triggered » (GT06 & co. : souvent 1 point toutes les 15-20s en
 * mouvement) : le marqueur glisse alors en continu d'un point réel au suivant,
 * au lieu de bondir toutes les 4s puis rester figé ~16s (audit TEMPS RÉEL
 * 2026-09-09, vidéo trajet moto). Reste borné : au-delà de GAP_ANIMATION_MS on
 * ne lisse plus (voir computeAnimationDuration). */
export const MAX_ANIMATION_MS = 20_000;

/** Au-delà de ce délai entre deux fixes, ce n'est plus un déplacement à lisser
 * mais une reconnexion après coupure : on NE fait PAS ramper le marqueur pendant
 * 20s sur une distance potentiellement énorme — on repositionne net (FALLBACK).
 * En dessous de OFFLINE_TIMEOUT_MIN (bascule « hors ligne » côté vehicleMap). */
export const GAP_ANIMATION_MS = 45_000;

/** Repli quand le delta réel est indisponible (premier fix, timestamp manquant
 * ou corrompu) OU quand le delta dépasse GAP_ANIMATION_MS (reconnexion). Valeur
 * courte : à défaut de timing réel exploitable, on ne fige pas le rendu. */
export const FALLBACK_ANIMATION_MS = 600;

/**
 * Durée d'animation en ms entre deux positions.
 *
 * @param prevTs     timestamp (epoch ms) de la position PRÉCÉDENTE, ou null
 *                   si c'est le premier fix de la session.
 * @param currTs     timestamp (epoch ms) de la position courante, ou null si
 *                   la source ne fournit pas d'horodatage fiable.
 * @returns delta réel borné par MAX_ANIMATION_MS ; FALLBACK_ANIMATION_MS si le
 *          delta est indisponible, non positif, ou trop grand (reconnexion).
 */
export function computeAnimationDuration(
  prevTs: number | null,
  currTs: number | null,
): number {
  if (prevTs === null || currTs === null) return FALLBACK_ANIMATION_MS;
  const delta = currTs - prevTs;
  if (!(delta > 0)) return FALLBACK_ANIMATION_MS; // horloge dérivante / fixes désordonnés
  if (delta > GAP_ANIMATION_MS) return FALLBACK_ANIMATION_MS; // gap de reconnexion : repositionnement net
  return Math.min(delta, MAX_ANIMATION_MS);
}
