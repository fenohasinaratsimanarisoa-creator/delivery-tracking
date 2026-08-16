package com.logitrack.app;

/**
 * Machine à états de DÉTECTION DU MOUVEMENT (3 états) pour l'acquisition GPS
 * adaptative de LocationForegroundService.
 *
 * POURQUOI CETTE CLASSE : la détection binaire historique
 * (isMoving = hasSpeed() && speed > seuil) est FAUSSE en signal GPS dégradé :
 * Location.hasSpeed() retourne false non seulement quand le véhicule est
 * réellement à l'arrêt, mais aussi quand le provider ne peut pas calculer de
 * vitesse fiable pour CE fix précis (tunnel, canyon urbain, couvert dense,
 * cold-fix après un trou de signal). Dans ce cas l'ancien code considérait le
 * véhicule à l'arrêt, ne rafraîchissait plus lastMovingTimestamp et basculait
 * à tort en cadence lente (20 s) après 90 s — exactement dans les zones où le
 * risque de trou de trace est le plus élevé.
 *
 * Les trois états explicites :
 *  - MOVING_CONFIRMED   : vitesse fiable (hasSpeed()==true) ET speed > seuil.
 *  - STATIONARY_CONFIRMED : soit vitesse fiable ET ≈ 0 (≤ seuil), soit PAS de
 *      vitesse mais la position n'a quasiment pas bougé sur ≥ 2 fixes
 *      consécutifs sans vitesse (distance haversine < 15 m vs position
 *      précédente) — l'arrêt est alors confirmé par la position, pas la vitesse.
 *  - UNKNOWN            : pas de vitesse ET position significativement
 *      différente de la précédente (ou premier fix sans référence). Aucune
 *      conclusion possible — NE compte PAS comme un arrêt prolongé.
 *
 * UNKNOWN prolongé ne fait PAS basculer en cadence lente : seul un état
 * STATIONARY_CONFIRMED prolongé au-delà de STATIONARY_SWITCH_DELAY_MS déclenche
 * shouldBeSlow()==true. Un signal durablement dégradé au point de ne jamais
 * confirmer l'arrêt est probablement synonyme de déplacement en zone difficile,
 * où la cadence rapide (3 s) est justement la plus utile.
 *
 * Classe volontairement PURE JAVA (aucune dépendance android.*) : la logique
 * est testable unitairement sur JVM (MotionStateDetectorTest.java), sans
 * Robolectric ni mock de Location.
 */
public class MotionStateDetector {

    /** Vitesse sous laquelle le véhicule est considéré à l'arrêt (~0.5 m/s ≈ 1.8 km/h). */
    private static final float STATIONARY_SPEED_THRESHOLD_MS = 0.5f;
    /** Délai d'arrêt continu avant de passer en cadence lente (évite le flap aux feux rouges). */
    private static final long STATIONARY_SWITCH_DELAY_MS = 90_000L;
    /**
     * Distance (m) en dessous de laquelle deux positions consécutives SANS
     * vitesse sont jugées « immobiles » : sert à confirmer l'arrêt par la
     * position quand le provider ne fournit pas de vitesse fiable (signal
     * dégradé). 15 m ≈ précision GPS civile (~5-10 m), tolérante aux jitters.
     */
    private static final double STATIONARY_POSITION_STAY_THRESHOLD_M = 15.0;
    /**
     * Nombre minimal de fixes consécutifs SANS vitesse et immobiles (distance
     * < STATIONARY_POSITION_STAY_THRESHOLD_M par rapport au fix précédent)
     * pour confirmer l'arrêt par la position. 2 fixes consécutifs : l'arrêt est
     * corroboré, pas un simple point de bruit.
     */
    private static final int STATIONARY_CONFIRM_MIN_FIXES = 2;

    public enum State {
        MOVING_CONFIRMED,
        STATIONARY_CONFIRMED,
        UNKNOWN,
    }

    /** Dernière position connue (référence pour la comparaison haversine). */
    private double lastLat = Double.NaN;
    private double lastLng = Double.NaN;
    /** Fixes consécutifs sans vitesse ET immobiles (compteur de corroboration de l'arrêt). */
    private int consecutiveNoSpeedStayFixes = 0;
    /** Dernier instant où le véhicule était CONFIRMÉ en mouvement. */
    private long lastMovingTimestamp = 0L;

    /**
     * Marque le départ du compteur d'arrêt (appelé au démarrage de l'acquisition) :
     * un véhicule immobile DÈS le début (livraison en cours de chargement le matin)
     * doit lui aussi passer en cadence lente après le délai de stabilisation — sans
     * ce point de départ, lastMovingTimestamp resterait 0 et le mode lent ne
     * s'activerait jamais.
     */
    public void markStart(long nowMs) {
        lastMovingTimestamp = nowMs;
    }

    /**
     * Décision complète de cadence pour un fix :
     * true = cadence lente (arrêt CONFIRMÉ et prolongé), false = cadence rapide.
     * Met à jour l'état interne (dernière position, compteurs, lastMovingTimestamp).
     */
    public boolean shouldBeSlow(boolean hasSpeed, float speedMps, double lat, double lng, long nowMs) {
        State state = classify(hasSpeed, speedMps, lat, lng);
        if (state == State.MOVING_CONFIRMED) {
            lastMovingTimestamp = nowMs;
        }
        return state == State.STATIONARY_CONFIRMED
            && lastMovingTimestamp > 0
            && (nowMs - lastMovingTimestamp) > STATIONARY_SWITCH_DELAY_MS;
    }

    /**
     * Classe le fix en 3 états explicites (voir Javadoc de classe). Un fix
     * UNKNOWN (pas de vitesse + déplacement, ou premier fix) ne confirme JAMAIS
     * l'arrêt : c'est le cœur du correctif — le mode lent ne peut être déclenché
     * que par un STATIONARY_CONFIRMED prolongé.
     */
    public State classify(boolean hasSpeed, float speedMps, double lat, double lng) {
        if (hasSpeed) {
            // Vitesse FIABLE : elle tranche. Le compteur d'arrêt sans vitesse n'a
            // plus de sens (une vitesse fiable réinitialise toute corroboration).
            consecutiveNoSpeedStayFixes = 0;
            updateLastPosition(lat, lng);
            if (speedMps > STATIONARY_SPEED_THRESHOLD_MS) {
                return State.MOVING_CONFIRMED;
            }
            // Vitesse fiable ET ≤ seuil : arrêt confirmé par la vitesse.
            return State.STATIONARY_CONFIRMED;
        }
        // PAS de vitesse fiable (signal dégradé) : on ne peut PAS conclure de la
        // vitesse. On compare la position courante à la précédente.
        if (hasLastPosition()) {
            double distance = haversineDistanceM(lastLat, lastLng, lat, lng);
            if (distance < STATIONARY_POSITION_STAY_THRESHOLD_M) {
                consecutiveNoSpeedStayFixes++;
            } else {
                // Déplacement net significatif : le véhicule a probablement bougé
                // (signal faible en mouvement) → corroboration remise à zéro.
                consecutiveNoSpeedStayFixes = 0;
            }
            updateLastPosition(lat, lng);
            if (consecutiveNoSpeedStayFixes >= STATIONARY_CONFIRM_MIN_FIXES) {
                return State.STATIONARY_CONFIRMED;
            }
            return State.UNKNOWN;
        }
        // Premier fix sans vitesse : aucune référence de comparaison.
        updateLastPosition(lat, lng);
        return State.UNKNOWN;
    }

    private boolean hasLastPosition() {
        return !Double.isNaN(lastLat) && !Double.isNaN(lastLng);
    }

    private void updateLastPosition(double lat, double lng) {
        lastLat = lat;
        lastLng = lng;
    }

    /**
     * Distance haversine entre deux coordonnées (mètres). Rayon terrestre moyen
     * 6371 km — suffisant pour comparer des positions GPS (jitter ~5-10 m).
     */
    public static double haversineDistanceM(double lat1, double lng1, double lat2, double lng2) {
        final double R = 6_371_000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
}
