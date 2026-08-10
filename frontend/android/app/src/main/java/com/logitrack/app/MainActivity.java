package com.logitrack.app;

import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
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
            }
        } catch (Exception e) {
            // Non bloquant : la WebView garde son fond par défaut.
            android.util.Log.w("MainActivity", "WebView background set skipped: " + e.getMessage());
        }
    }
}
