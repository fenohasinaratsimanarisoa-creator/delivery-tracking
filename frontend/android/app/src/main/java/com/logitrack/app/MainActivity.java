package com.logitrack.app;

import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Capture des crashs AVANT tout (MIUI/Samsung verrouillent le logcat : seul un
        // fichier de crash est lisible). Le rapport est écrit dans
        // /data/data/com.logitrack.app/files/crash_*.log (debug → via adb run-as).
        CrashReportHandler.install(this);
        registerPlugin(BackgroundLocationPlugin.class);
        super.onCreate(savedInstanceState);

        // Fond explicite de la WebView = couleur réelle de l'app (thème sombre par défaut,
        // var(--color-bg) → #0B1220 dans src/styles/theme.ts). Évite qu'une zone non
        // repeinte pendant la transition clavier (adjustPan + resize JS) n'apparaisse
        // noire/blanche selon le thème.
        // getBridge() peut être null si le bridge n'est pas encore initialisé (ex. rotation
        // rapide, config) : garde défensive pour ne JAMAIS crasher au démarrage.
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().setBackgroundColor(Color.rgb(11, 18, 32));

                // User-Agent navigateur STANDARD : OpenStreetMap renvoie la tuile d'erreur
                // "Map data not yet available" aux User-Agents WebView/Capacitor qu'elle ne
                // reconnaît pas (politique anti-scraping). Un UA Chrome Android complet
                // contourne ce blocage et restaure le fond de carte.
                android.webkit.WebSettings settings = getBridge().getWebView().getSettings();
                String ua = settings.getUserAgentString();
                // Évite de dupliquer le marqueur si le fix est déjà appliqué.
                if (ua != null && !ua.contains("deliverytrack-app-ua")) {
                    settings.setUserAgentString(ua + " deliverytrack-app-ua Chrome/120 Mobile Safari/537.36");
                }
            }
        } catch (Exception e) {
            // Non bloquant : la WebView garde son fond par défaut.
            android.util.Log.w("MainActivity", "WebView init skipped: " + e.getMessage());
        }
    }

    /**
     * Flush EXPLICITE du CookieManager Android à chaque passage en arrière-plan.
     *
     * BUG CORRIGÉ (observé en usage réel, logs backend : 401 systématique sur
     * /auth/refresh à CHAQUE réouverture après une fermeture complète de l'app) :
     * android.webkit.CookieManager garde les cookies récemment posés/modifiés
     * (dont le cookie refreshToken, ROTATÉ à chaque appel réussi de /auth/refresh)
     * dans un cache mémoire avant de les écrire sur le disque (base SQLite
     * interne à la WebView) — cette écriture n'est PAS synchrone à chaque
     * Set-Cookie. Un kill brutal du process (swipe des tâches récentes, ou
     * simplement l'OS qui tue le process en arrière-plan sous pression mémoire —
     * exactement le scénario que ce chantier de persistance native adresse pour
     * le GPS) pouvait donc perdre le tout dernier cookie refreshToken roté,
     * avant même qu'il soit écrit sur disque : au réveil, la WebView ne
     * connaissait plus qu'un cookie déjà périmé (ou aucun) → refresh 401 →
     * l'utilisateur devait se reconnecter à CHAQUE réouverture, alors même que
     * la session côté serveur restait valide.
     *
     * onPause()/onStop() sont les callbacks de cycle de vie les plus fiables
     * juste avant un passage en arrière-plan (appelés même si le process est
     * ensuite tué peu après) — flush() est un appel synchrone bon marché,
     * jamais bloquant pour l'UI (il écrit juste le cache déjà en mémoire).
     */
    private void flushCookies() {
        try {
            android.webkit.CookieManager.getInstance().flush();
        } catch (Exception e) {
            android.util.Log.w("MainActivity", "Cookie flush failed: " + e.getMessage());
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        flushCookies();
    }

    @Override
    public void onStop() {
        super.onStop();
        flushCookies();
    }
}
