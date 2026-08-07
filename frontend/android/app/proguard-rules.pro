# ─────────────────────────────────────────────────────────────
# ProGuard / R8 — Capacitor Android
# Référence officielle : https://capacitorjs.com/docs/android/troubleshooting#proguard
# Les plugins Capacitor s'appuient sur la réflexion (annotations @CapacitorPlugin,
# PluginMethod, Bridge) : il faut les conserver sous R8 (minifyEnabled true).
# ─────────────────────────────────────────────────────────────

# Attributs utilisés par la réflexion du pont Capacitor
-keepattributes *Annotation*,InnerClasses,EnclosingMethod,Signature

# Cœur Capacitor
-keep class com.getcapacitor.Bridge { *; }
-keep class com.getcapacitor.BridgeActivity { *; }
-keep class com.getcapacitor.BridgeWebChromeClient { *; }
-keep class com.getcapacitor.BridgeWebViewClient { *; }
-keep class com.getcapacitor.Plugin { *; }
-keep class com.getcapacitor.PluginCall { *; }
-keep class com.getcapacitor.PluginHandle { *; }
-keep class com.getcapacitor.PluginMethod { *; }
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.annotation.** { *; }
-keep class com.getcapacitor.cordova.** { *; }

# Plugins Capacitor tiers embarqués
-keep class com.capacitorjs.plugins.** { *; }

# Toute classe annotée @CapacitorPlugin (découverte / permissions)
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keep class * extends com.getcapacitor.Plugin { *; }

# Framework Cordova (transitif via Capacitor)
-keep class org.apache.cordova.** { *; }

# Plugin natif maison (recherché par le pont + service foreground)
-keep class com.logitrack.app.BackgroundLocationPlugin { *; }
-keep class com.logitrack.app.LocationForegroundService { *; }

# Interface JS du WebView (pont natif ↔ JS)
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Informations de ligne pour les stack traces (utile en production)
-keepattributes SourceFile,LineNumberTable
