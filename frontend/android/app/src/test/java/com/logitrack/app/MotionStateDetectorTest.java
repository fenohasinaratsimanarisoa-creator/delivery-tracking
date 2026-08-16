package com.logitrack.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Tests unitaires JVM (aucune dépendance Android) de la détection de mouvement
 * à 3 états (MotionStateDetector) qui pilote la cadence GPS adaptative.
 *
 * Cas critiques :
 *  - déplacement en signal faible (hasSpeed()==false mais position qui change) :
 *    UNKNOWN prolongé doit garder la cadence rapide (shouldBeSlow == false) —
 *    c'est le bug corrigé (l'ancienne détection binaire basculait à tort en 20 s) ;
 *  - arrêt nominal (vitesse fiable ≈ 0 stable) : doit TOUJOURS basculer en mode
 *    lent après STATIONARY_SWITCH_DELAY_MS (90 s), comme avant.
 */
public class MotionStateDetectorTest {

    private static final long T0 = 1_000_000L;

    @Test
    public void movementInWeakSignal_hasSpeedFalse_neverSwitchesToSlowEvenAfter90s() {
        MotionStateDetector detector = new MotionStateDetector();
        detector.markStart(T0);

        // Séquence de fixes SANS vitesse (signal dégradé : tunnel/canyon/couvert)
        // mais avec une position qui change (~111 m par fix) : le véhicule ROULÉ.
        // 10 fixes × 30 s = 300 s simulées, largement au-delà des 90 s du bug.
        for (int i = 1; i <= 10; i++) {
            long now = T0 + i * 30_000L;
            double lat = -18.8792 + i * 0.001; // 0.001° ≈ 111 m : déplacement net
            boolean slow = detector.shouldBeSlow(false, 0f, lat, 47.5079, now);
            assertFalse(
                "UNKNOWN prolongé ne doit jamais basculer en cadence lente (fix n°" + i + ")",
                slow
            );
        }
    }

    @Test
    public void firstFixWithoutSpeed_isUnknown_andNeverSwitchesToSlow() {
        MotionStateDetector detector = new MotionStateDetector();
        detector.markStart(T0);

        // Premier fix : aucune référence de comparaison → UNKNOWN, jamais slow.
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 10_000L));
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 95_000L));
    }

    @Test
    public void parkedWithReliableSpeed_zeroStillSwitchesToSlowAfter90s() {
        // Cas NOMINAL à préserver : véhicule à l'arrêt, bon signal, speed ≈ 0 stable.
        MotionStateDetector detector = new MotionStateDetector();
        detector.markStart(T0);

        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 10_000L));
        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 60_000L));
        // 90 s pile : strictement supérieur requis (90_000 > 90_000 est faux).
        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 90_000L));
        // Au-delà de 90 s d'arrêt confirmé → cadence lente.
        assertTrue(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 91_000L));
    }

    @Test
    public void parkedWithoutSpeed_stillSwitchesToSlowAfterPositionConfirmation() {
        // Arrêt confirmé par la POSITION (pas de vitesse dispo) : après ≥ 2 fixes
        // consécutifs immobiles, l'arrêt est confirmé → mode lent après 90 s.
        MotionStateDetector detector = new MotionStateDetector();
        detector.markStart(T0);

        // Fix 1 : premier sans vitesse → UNKNOWN. Fix 2 : 1er « immobile » (< 15 m).
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 10_000L));
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 20_000L));
        // Fix 3 : 2e « immobile » consécutif → STATIONARY_CONFIRMED, mais < 90 s.
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 30_000L));
        // 90 s pile : pas encore strictement au-delà.
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 90_000L));
        // Au-delà de 90 s d'arrêt CONFIRMÉ (par position) → cadence lente.
        assertTrue(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 91_000L));
    }

    @Test
    public void briefPositionNoise_doesNotConfirmStationary() {
        // Un seul fix immobile suivi d'un déplacement : jamais confirmé arrêt.
        MotionStateDetector detector = new MotionStateDetector();
        detector.markStart(T0);

        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 10_000L)); // 1er fix : UNKNOWN
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8792, 47.5079, T0 + 13_000L)); // immobile (1 seul fix : pas confirmé)
        // Le véhicule repart (position très différente) : corroboration remise à zéro.
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8750, 47.5079, T0 + 16_000L));
        // Nouveau début d'immobilité : fix isolé, pas encore 2 consécutifs immobiles.
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8751, 47.5079, T0 + 19_000L));
        // 2e fix consécutif immobile → arrêt confirmé par la position, mais le tout
        // reste bien SOUS 90 s depuis markStart : aucune bascule en cadence lente.
        assertFalse(detector.shouldBeSlow(false, 0f, -18.8751, 47.5079, T0 + 22_000L));
    }

    @Test
    public void movingFixRefreshesLastMovingTimestamp_slowTimerRestarts() {
        // 60 s d'arrêt confirmé (vitesse ≈ 0), puis le véhicule repart (vitesse
        // fiable > seuil) : le compteur 90 s doit REDÉMARRER depuis ce mouvement.
        MotionStateDetector detector = new MotionStateDetector();
        detector.markStart(T0);

        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 30_000L));
        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 60_000L));
        // Repart : fix en mouvement confirmé (vitesse 8 m/s).
        assertFalse(detector.shouldBeSlow(true, 8.0f, -18.8792, 47.5079, T0 + 61_000L));
        // Re-arrêt : 39 s puis 89 s après le mouvement → toujours pas 90 s écoulées.
        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 100_000L));
        assertFalse(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 150_000L));
        // 91 s après le dernier mouvement confirmé → cadence lente.
        assertTrue(detector.shouldBeSlow(true, 0f, -18.8792, 47.5079, T0 + 152_000L));
    }

    @Test
    public void haversineDistance_returnsExpectedMeters() {
        // 0.001° de latitude ≈ 111.19 m. Tolérance ±2 m (formule haversine simple).
        double distance = MotionStateDetector.haversineDistanceM(
            -18.8792, 47.5079,
            -18.8782, 47.5079
        );
        assertTrue("distance=" + distance, distance > 109.0 && distance < 113.0);
        // Même point : distance nulle.
        assertTrue(MotionStateDetector.haversineDistanceM(1.0, 2.0, 1.0, 2.0) < 0.0001);
    }
}
