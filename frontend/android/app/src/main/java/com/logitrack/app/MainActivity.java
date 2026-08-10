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
}
