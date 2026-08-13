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

/** Durée max d'animation : couvre l'intervalle nominal (3s) + variabilité
 * JS/natif/arrière-plan, sans jamais « rattraper » un long gap de reconnexion. */
export const MAX_ANIMATION_MS = 4000;

/** Repli quand le delta réel est indisponible (premier fix, timestamp manquant
 * ou corrompu). Valeur courte : à défaut de timing réel, on ne fige pas le rendu. */
export const FALLBACK_ANIMATION_MS = 600;

/**
 * Durée d'animation en ms entre deux positions.
 *
 * @param prevTs     timestamp (epoch ms) de la position PRÉCÉDENTE, ou null
 *                   si c'est le premier fix de la session.
 * @param currTs     timestamp (epoch ms) de la position courante, ou null si
 *                   la source ne fournit pas d'horodatage fiable.
 * @returns delta réel borné par MAX_ANIMATION_MS, sinon FALLBACK_ANIMATION_MS.
 */
export function computeAnimationDuration(
  prevTs: number | null,
  currTs: number | null,
): number {
  if (prevTs === null || currTs === null) return FALLBACK_ANIMATION_MS;
  const delta = currTs - prevTs;
  if (!(delta > 0)) return FALLBACK_ANIMATION_MS; // horloge dérivante / fixes désordonnés
  return Math.min(delta, MAX_ANIMATION_MS);
}