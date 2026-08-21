package com.logitrack.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Fallback HTTP natif de secours (Option B — audit 21/08/2026).
 *
 * QUAND ÇA S'ACTIVE :
 *   LocationForegroundService acquiert des positions nativement (FusedLocationProviderClient)
 *   mais la WebView est gelée (MIUI/EMUI en Doze agressif, écran verrouillé prolongé).
 *   Le JS ne traite plus les événements notifyListeners() → les positions ne partent pas.
 *   Si le dernier ACK JS date de > NATIVE_FALLBACK_THRESHOLD_MS (2 min), ce fallback
 *   envoie les positions directement via HttpURLConnection vers POST /api/tracking/batch-position.
 *
 * CONTRAINTES :
 *   - Le token d'accès est lu depuis SharedPreferences ("logitrack_native_fallback_token"),
 *     écrit par le JS via BackgroundLocationPlugin.storeNativeFallbackToken().
 *   - Si le token est expiré ou absent, on LOG l'échec et on ne tente PAS l'envoi :
 *     la prochaine tentative du JS au réveil de la WebView s'en chargera.
 *   - Zéro dépendance externe (HttpURLConnection est dans le SDK Android).
 *   - Format d'envoi IDENTIQUE à batchPosition JS : { positions: UpdatePositionDto[] }.
 *
 * NOTE : ce fallback ne remplace PAS le pipeline JS (socket.io + offlineQueue.ts).
 * Il ne s'active qu'en dernier recours quand le JS est silencieux > 2 min.
 */
public class NativeHttpFallback {

    private static final String TAG = "NativeHttpFallback";

    /** SharedPreferences contenant le token et l'URL API. */
    private static final String PREFS_NAME = "logitrack_native_fallback";
    private static final String PREF_TOKEN = "access_token";
    private static final String PREF_API_URL = "api_base_url";

    /** Seuil de silence JS avant déclenchement du fallback (2 minutes). */
    public static final long NATIVE_FALLBACK_THRESHOLD_MS = 120_000;

    /** Interval minimal entre deux envois natifs (30 secondes). */
    private static final long MIN_SEND_INTERVAL_MS = 30_000;

    /** Dernier envoi réussi (pour throttle). */
    private static volatile long lastSendTime = 0;

    /**
     * Écrit le token d'accès dans SharedPreferences (appelé par le JS via
     * BackgroundLocationPlugin.storeNativeFallbackToken() à chaque refresh).
     */
    public static void storeToken(Context context, String token) {
        if (token == null || token.isEmpty()) return;
        getPrefs(context).edit().putString(PREF_TOKEN, token).apply();
    }

    /**
     * Écrit l'URL de base de l'API dans SharedPreferences (appelé par le JS au démarrage).
     */
    public static void storeApiUrl(Context context, String apiUrl) {
        if (apiUrl == null || apiUrl.isEmpty()) return;
        getPrefs(context).edit().putString(PREF_API_URL, apiUrl).apply();
    }

    /**
     * Vérifie si le fallback doit s'activer.
     * @param lastJsAckTime timestamp du dernier ACK JS (notifyListeners traité par le pipeline)
     * @return true si le JS est silencieux depuis > NATIVE_FALLBACK_THRESHOLD_MS
     */
    public static boolean shouldActivate(long lastJsAckTime) {
        if (lastJsAckTime <= 0) return false;
        return System.currentTimeMillis() - lastJsAckTime > NATIVE_FALLBACK_THRESHOLD_MS;
    }

    /**
     * Envoie une position au backend via HTTP POST.
     * Thread-safe : peut être appelé depuis le callback GPS (main looper).
     * L'envoi est fait sur un thread dédié (ExecutorService) pour ne pas bloquer.
     *
     * @param context   Android context
     * @param location  Position à envoyer
     * @param vehicleId ID du véhicule
     * @param deliveryId ID de la livraison (peut être null)
     */
    public static void sendPosition(Context context, Location location, String vehicleId, String deliveryId) {
        if (location == null || vehicleId == null || vehicleId.isEmpty()) return;

        // Throttle : pas plus d'un envoi toutes les 30 secondes
        long now = System.currentTimeMillis();
        if (now - lastSendTime < MIN_SEND_INTERVAL_MS) return;
        lastSendTime = now;

        String token = getPrefs(context).getString(PREF_TOKEN, null);
        String apiUrl = getPrefs(context).getString(PREF_API_URL, null);

        if (token == null || token.isEmpty()) {
            Log.w(TAG, "Pas de token natif — envoi ignoré (le JS gérera au réveil)");
            return;
        }
        if (apiUrl == null || apiUrl.isEmpty()) {
            Log.w(TAG, "Pas d'URL API native — envoi ignoré");
            return;
        }

        // Exécution sur un thread dédié pour ne pas bloquer le main looper
        final String finalToken = token;
        final String finalApiUrl = apiUrl;
        final String isoTimestamp = formatIsoTimestamp(now);
        final double lat = location.getLatitude();
        final double lng = location.getLongitude();
        final float speed = location.hasSpeed() ? location.getSpeed() : 0;
        final float heading = location.hasBearing() ? location.getBearing() : 0;
        final double altitude = location.hasAltitude() ? location.getAltitude() : 0;
        final float accuracy = location.hasAccuracy() ? location.getAccuracy() : 50;

        Thread thread = new Thread(() -> {
            try {
                JSONObject position = new JSONObject();
                position.put("latitude", lat);
                position.put("longitude", lng);
                position.put("speed", speed);
                position.put("heading", heading);
                position.put("altitude", altitude);
                position.put("accuracy", accuracy);
                position.put("timestamp", isoTimestamp);
                position.put("vehicleId", vehicleId);
                if (deliveryId != null && !deliveryId.isEmpty()) {
                    position.put("deliveryId", deliveryId);
                }

                JSONObject payload = new JSONObject();
                JSONArray positions = new JSONArray();
                positions.put(position);
                payload.put("positions", positions);

                String body = payload.toString();
                String endpoint = finalApiUrl.replaceAll("/+$", "") + "/tracking/batch-position";

                HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
                try {
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Authorization", "Bearer " + finalToken);
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(10_000);
                    conn.setReadTimeout(10_000);

                    try (OutputStream os = conn.getOutputStream()) {
                        os.write(body.getBytes(StandardCharsets.UTF_8));
                    }

                    int code = conn.getResponseCode();
                    if (code >= 200 && code < 300) {
                        Log.i(TAG, "Position native envoyée avec succès (HTTP " + code + ")");
                    } else {
                        // Lire le body d'erreur pour le diagnostic
                        StringBuilder errorBody = new StringBuilder();
                        try (BufferedReader br = new BufferedReader(
                                new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                            String line;
                            while ((line = br.readLine()) != null) errorBody.append(line);
                        } catch (Exception ignored) {}
                        Log.w(TAG, "Échec envoi natif HTTP " + code + " : " + errorBody);
                    }
                } finally {
                    conn.disconnect();
                }
            } catch (Exception e) {
                Log.e(TAG, "Erreur envoi position native", e);
            }
        }, "native-fallback-send");
        thread.setDaemon(true);
        thread.start();
    }

    private static SharedPreferences getPrefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static String formatIsoTimestamp(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }
}
