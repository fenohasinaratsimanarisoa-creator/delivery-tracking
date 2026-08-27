package com.logitrack.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.telephony.SmsMessage;
import android.util.Log;

import androidx.annotation.NonNull;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Réception du canal de secours SMS zéro-connectivité (audit terrain
 * 2026-08-27) — voir SmsFallbackManager.java (émission, côté chauffeur) pour
 * le contexte complet.
 *
 * Ce receiver tourne dans TOUS les exemplaires de l'app installés, mais ne
 * fait quoi que ce soit QUE sur le téléphone explicitement activé en "mode
 * passerelle" (PREF_GATEWAY_MODE_ENABLED) — un téléphone chauffeur normal
 * ignore silencieusement tout SMS entrant, sans effet de bord ni permission
 * supplémentaire demandée. Un seul téléphone-passerelle par entreprise, fixe
 * au bureau, avec sa propre connexion internet.
 *
 * Filtrage : seuls les SMS commençant par le préfixe "LT1:" (voir
 * SmsFallbackManager.buildSmsBody) sont traités — tout le reste du trafic SMS
 * de ce téléphone (SMS personnels, notifications d'opérateur…) passe
 * normalement, ce receiver ne consomme JAMAIS le broadcast (pas d'abortBroadcast).
 */
public class GatewaySmsReceiver extends BroadcastReceiver {

    private static final String TAG = "GatewaySmsReceiver";
    private static final String PREFS_NAME = "logitrack_sms_gateway";
    static final String PREF_GATEWAY_MODE_ENABLED = "gateway_mode_enabled";
    static final String PREF_API_URL = "gateway_api_url";
    static final String PREF_API_KEY = "gateway_api_key";
    private static final String SMS_PREFIX = "LT1:";

    private static final ExecutorService RELAY_EXECUTOR = Executors.newSingleThreadExecutor();

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = prefs(context);
        if (!prefs.getBoolean(PREF_GATEWAY_MODE_ENABLED, false)) {
            return; // Téléphone chauffeur normal — aucun traitement, aucun coût.
        }
        String apiUrl = prefs.getString(PREF_API_URL, null);
        String apiKey = prefs.getString(PREF_API_KEY, null);
        if (apiUrl == null || apiUrl.isEmpty() || apiKey == null || apiKey.isEmpty()) {
            Log.w(TAG, "Mode passerelle activé mais apiUrl/apiKey non configurés — SMS ignoré");
            return;
        }

        SmsMessage[] messages = getMessagesFromIntent(intent);
        if (messages == null || messages.length == 0) return;

        // Concatène les segments (un SMS LT1 tient normalement en un seul
        // segment, mais l'intent peut légitimement en contenir plusieurs pour
        // un message long — comportement standard Android à respecter).
        StringBuilder bodyBuilder = new StringBuilder();
        String sender = null;
        for (SmsMessage msg : messages) {
            if (msg == null) continue;
            if (sender == null) sender = msg.getOriginatingAddress();
            String part = msg.getMessageBody();
            if (part != null) bodyBuilder.append(part);
        }
        String body = bodyBuilder.toString();
        if (sender == null || !body.startsWith(SMS_PREFIX)) {
            return; // Pas un SMS de ce protocole — on ne touche à rien.
        }

        final String finalSender = sender;
        final String finalApiUrl = apiUrl;
        final String finalApiKey = apiKey;

        // onReceive() tourne sur le main thread avec une fenêtre d'exécution
        // limitée (~10s) — goAsync() + thread dédié pour l'appel réseau, sinon
        // le système peut tuer le process avant la fin du POST.
        PendingResult pendingResult = goAsync();
        RELAY_EXECUTOR.execute(() -> {
            try {
                relayToBackend(finalApiUrl, finalApiKey, finalSender, body);
            } catch (Exception e) {
                Log.w(TAG, "Echec relais SMS vers le backend", e);
            } finally {
                pendingResult.finish();
            }
        });
    }

    /** Wrapper testable (androidTest) : évite de dépendre de Telephony.Sms.Intents en JVM pur. */
    @NonNull
    static SmsMessage[] getMessagesFromIntent(Intent intent) {
        android.telephony.SmsMessage[] msgs = android.provider.Telephony.Sms.Intents.getMessagesFromIntent(intent);
        return msgs != null ? msgs : new SmsMessage[0];
    }

    /**
     * Parse "LT1:<lat>,<lng>,<accuracy>,<epochSec>" et POST vers
     * /tracking/positions/sms-relay. Lance IOException/JSONException sur échec
     * — capturée par l'appelant (onReceive), jamais remontée au système.
     */
    private static void relayToBackend(String apiUrl, String apiKey, String senderPhone, String body)
        throws IOException, JSONException {
        String payload = body.substring(SMS_PREFIX.length());
        String[] parts = payload.split(",");
        if (parts.length != 4) {
            Log.w(TAG, "Format SMS LT1 invalide (attendu 4 champs, reçu " + parts.length + ")");
            return;
        }
        double lat = Double.parseDouble(parts[0]);
        double lng = Double.parseDouble(parts[1]);
        double accuracy = Double.parseDouble(parts[2]);
        long epochSec = Long.parseLong(parts[3]);

        JSONObject json = new JSONObject();
        json.put("senderPhone", senderPhone);
        json.put("latitude", lat);
        json.put("longitude", lng);
        if (accuracy >= 0) json.put("accuracy", accuracy);
        json.put("timestamp", formatIsoTimestamp(epochSec * 1000L));

        String endpoint = apiUrl.replaceAll("/+$", "") + "/tracking/positions/sms-relay";
        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            // SÉCURITÉ : ne JAMAIS logger apiKey.
            conn.setRequestProperty("X-API-Key", apiKey);
            conn.setDoOutput(true);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(json.toString().getBytes(StandardCharsets.UTF_8));
            }
            int status = conn.getResponseCode();
            if (status >= 200 && status < 300) {
                Log.i(TAG, "SMS relayé avec succès (sender=" + senderPhone + ")");
            } else {
                // 422 (no_driver_match/rejected) ou autre : le SMS reste dans la
                // boîte de réception normale du téléphone-passerelle — aucune
                // perte, juste pas de retry automatique (pas de file locale ici,
                // volontairement — voir doc de classe : la passerelle a une
                // connexion fiable, contrairement au chauffeur émetteur).
                Log.w(TAG, "Relais SMS refusé par le serveur (HTTP " + status + ")");
            }
        } finally {
            conn.disconnect();
        }
    }

    private static String formatIsoTimestamp(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }

    static void setGatewayMode(Context context, boolean enabled, String apiUrl, String apiKey) {
        SharedPreferences.Editor editor = prefs(context).edit().putBoolean(PREF_GATEWAY_MODE_ENABLED, enabled);
        if (apiUrl != null) editor.putString(PREF_API_URL, apiUrl);
        if (apiKey != null) editor.putString(PREF_API_KEY, apiKey);
        editor.apply();
    }

    static boolean isGatewayModeEnabled(Context context) {
        return prefs(context).getBoolean(PREF_GATEWAY_MODE_ENABLED, false);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
