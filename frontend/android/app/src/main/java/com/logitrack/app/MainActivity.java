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
        getBridge().getWebView().setBackgroundColor(Color.rgb(11, 18, 32));
    }
}
