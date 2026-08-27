package com.logitrack.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.telephony.SmsManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

import java.util.Locale;

/**
 * Canal de secours SMS zéro-connectivité (audit terrain 2026-08-27).
 *
 * POURQUOI : sans DATA ni WiFi, aucune position ne peut sortir du téléphone —
 * limite physique, pas un bug (voir échange avec l'utilisateur). Mais en zone
 * rurale à Madagascar, le réseau GSM (voix/SMS) reste souvent disponible là où
 * la data ne l'est pas (couverture 2G plus large, ou forfait data épuisé alors
 * que le crédit SMS/appel reste actif). Ce canal envoie la position par SMS à
 * un téléphone-passerelle fixe (au bureau, avec sa propre connexion internet —
 * voir GatewaySmsReceiver côté réception) quand :
 *  - la synchronisation normale (PositionUploadWorker, HTTP) n'a pas réussi
 *    depuis plus de OFFLINE_THRESHOLD_MS ;
 *  - un numéro de passerelle est configuré ;
 *  - la permission SEND_SMS est accordée ;
 *  - au moins SMS_THROTTLE_MS s'est écoulé depuis le dernier SMS envoyé (un
 *    SMS par fix GPS, toutes les 2-3s, viderait un crédit SMS en quelques
 *    minutes — throttlé à UN SMS par fenêtre, largement suffisant pour une
 *    position de secours, pas un tracking temps réel).
 *
 * Format du SMS (voir SmsRelayPositionDto côté backend, GatewaySmsReceiver
 * côté parsing) : "LT1:<lat>,<lng>,<accuracy>,<epochSec>" — préfixe LT1
 * (LogiTrack v1) pour que la passerelle reconnaisse sans ambiguïté un SMS de
 * ce protocole parmi tout le reste du trafic SMS qu'elle reçoit, et pour
 * permettre une évolution de format (LT2…) sans casser la compatibilité.
 */
final class SmsFallbackManager {

    private static final String TAG = "SmsFallbackManager";
    private static final String PREFS_NAME = "logitrack_sms_fallback";
    private static final String PREF_GATEWAY_NUMBER = "gateway_number";
    private static final String PREF_LAST_SYNC_SUCCESS_AT = "last_sync_success_at";
    private static final String PREF_LAST_SMS_SENT_AT = "last_sms_sent_at";

    /** Délai sans synchronisation HTTP réussie avant de considérer le secours SMS. */
    private static final long OFFLINE_THRESHOLD_MS = 10 * 60 * 1000L; // 10 min
    /** Un SMS de secours au plus par fenêtre — jamais un par fix GPS. */
    private static final long SMS_THROTTLE_MS = 10 * 60 * 1000L; // 10 min

    private SmsFallbackManager() {
    }

    /** Appelé par PositionUploadWorker à CHAQUE upload HTTP réussi (2xx). */
    static void markSyncSuccess(Context context) {
        try {
            prefs(context).edit().putLong(PREF_LAST_SYNC_SUCCESS_AT, System.currentTimeMillis()).apply();
        } catch (Exception ignored) {
        }
    }

    static void setGatewayNumber(Context context, String number) {
        try {
            prefs(context).edit().putString(PREF_GATEWAY_NUMBER, number).apply();
        } catch (Exception ignored) {
        }
    }

    static String getGatewayNumber(Context context) {
        try {
            return prefs(context).getString(PREF_GATEWAY_NUMBER, null);
        } catch (Exception e) {
            return null;
        }
    }

    static boolean hasSendSmsPermission(Context context) {
        return ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Appelé depuis LocationForegroundService.handleLocationUpdate à CHAQUE fix
     * GPS acquis. No-op immédiat (aucun accès disque/réseau) si les conditions de
     * base ne sont pas réunies — coût négligeable sur le chemin critique GPS→JS.
     */
    static void maybeSendFallbackSms(Context context, Location loc) {
        try {
            String gatewayNumber = getGatewayNumber(context);
            if (gatewayNumber == null || gatewayNumber.trim().isEmpty()) {
                return; // Pas configuré — repli désactivé pour ce chauffeur.
            }
            if (!hasSendSmsPermission(context)) {
                return; // Permission jamais accordée ou révoquée depuis.
            }

            SharedPreferences p = prefs(context);
            long now = System.currentTimeMillis();
            long lastSync = p.getLong(PREF_LAST_SYNC_SUCCESS_AT, 0L);
            // Aucune synchronisation réussie ENREGISTRÉE depuis le démarrage de
            // l'app (lastSync=0) : ne PAS considérer ça comme "hors ligne depuis
            // toujours" avant d'avoir laissé une vraie chance au chemin HTTP
            // normal — sinon le tout premier départ (avant le premier succès
            // réseau) déclencherait un SMS immédiatement à chaque lancement.
            if (lastSync == 0L) {
                return;
            }
            if (now - lastSync < OFFLINE_THRESHOLD_MS) {
                return; // Le chemin normal (HTTP) fonctionne encore, ou l'a fait récemment.
            }
            long lastSms = p.getLong(PREF_LAST_SMS_SENT_AT, 0L);
            if (now - lastSms < SMS_THROTTLE_MS) {
                return; // Throttle : un SMS de secours par fenêtre, pas par fix.
            }

            String body = buildSmsBody(loc);
            SmsManager smsManager = SmsManager.getDefault();
            smsManager.sendTextMessage(gatewayNumber, null, body, null, null);
            p.edit().putLong(PREF_LAST_SMS_SENT_AT, now).apply();
            Log.i(TAG, "SMS de secours envoye (hors ligne depuis " + ((now - lastSync) / 1000) + "s)");
        } catch (Exception e) {
            // Jamais bloquant pour le chemin GPS→JS principal — le prochain fix
            // retentera (throttle non consommé si l'envoi a échoué avant apply()).
            Log.w(TAG, "Echec envoi SMS de secours", e);
        }
    }

    /** Format compact : "LT1:<lat>,<lng>,<accuracy>,<epochSec>" — voir doc de classe. */
    static String buildSmsBody(Location loc) {
        float accuracy = loc.hasAccuracy() ? loc.getAccuracy() : -1f;
        long epochSec = loc.getTime() / 1000L;
        return String.format(
            Locale.US,
            "LT1:%.6f,%.6f,%.1f,%d",
            loc.getLatitude(),
            loc.getLongitude(),
            accuracy,
            epochSec
        );
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }
}
