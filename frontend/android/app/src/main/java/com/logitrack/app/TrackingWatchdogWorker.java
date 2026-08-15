package com.logitrack.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Watchdog de surveillance du foreground service de localisation.
 *
 * WorkManager exécute ce worker périodiquement (toutes les 15 min, l'intervalle
 * minimal permis par PeriodicWorkRequest). Son rôle : si l'utilisateur a démarré
 * un tracking (SharedPreferences "tracking_should_be_active" = true) mais que
 * LocationForegroundService n'est PAS en cours d'exécution (process tué par
 * Android, service arrêté par le système, crash…), il le redémarre.
 *
 * POURQUOI CET ARCHITECTURE :
 * START_STICKY seul ne suffit pas : si le process est entièrement tué (low
 * memory, cache eviction, force-stop partiel), Android ne relance pas toujours
 * un foreground service, et rien ne surveille l'état. WorkManager est exécuté
 * par le même process et est fiabilisé par le système (persistance sur
 * disque, re-planification après reboot). En vérifiant l'état voulu (pref) vs
 * l'état réel (isRunning), on comble les trous que START_STICKY laisse passer.
 *
 * DÉPENDANCE BUG n°2 (acquisition FusedLocationProviderClient) : le redémarrage
 * ici passe par startForegroundService(ACTION_START), ce qui relance
 * onStartCommand() de LocationForegroundService → startInForeground() ET
 * startLocationUpdates() : l'acquisition GPS native (indépendante de la WebView)
 * est donc aussi restaurée par le watchdog, pas seulement le process.
 *
 * TRACABILITÉ DES ÉCHECS : un échec de redémarrage ne doit jamais être
 * silencieux. En cas d'exception, on logge explicitement (adb logcat), on
 * incrémente un compteur d'échecs consécutifs (SharedPreferences) et on
 * notifie le chauffeur dès que le seuil est franchi ; Result.retry() laisse
 * WorkManager appliquer son backoff exponentiel par défaut au lieu d'attendre
 * le prochain cycle de 15 min. Le compteur est remis à zéro dès que le service
 * est (re)devenu actif.
 */
public class TrackingWatchdogWorker extends Worker {

    public static final String WATCHDOG_WORK_NAME = "logitrack_tracking_watchdog";
    public static final String PREFS_NAME = "logitrack_tracking";
    public static final String PREF_TRACKING_ACTIVE = "tracking_should_be_active";

    /** Marqueur d'interruption NON volontaire du tracking : lue par le JS au
     *  prochain lancement (getInterruptionInfo) pour signaler au backend qu'un
     *  tracking actif a été interrompu (notification dashboard). Écrit par le
     *  watchdog quand il détecte le service mort, et par le service lui-même en
     *  onDestroy non-volontaire. */
    public static final String PREF_TRACKING_INTERRUPTED_AT = "tracking_interrupted_at";
    public static final String PREF_TRACKING_INTERRUPTED_REASON = "tracking_interrupted_reason";

    /** Compteur d'échecs consécutifs de redémarrage du service. */
    public static final String PREF_RESTART_FAILURES = "tracking_restart_failures";
    /** Seuil au-delà duquel le chauffeur est notifié (3 échecs consécutifs). */
    private static final int FAILURE_NOTIFICATION_THRESHOLD = 3;
    private static final String TAG = "TrackingWatchdog";
    /** Canal dédié pour la notification d'alerte (indépendant de la notification de service). */
    private static final String ALERT_CHANNEL_ID = "logitrack_watchdog_alert";
    private static final String ALERT_CHANNEL_NAME = "Alertes suivi";
    private static final int ALERT_NOTIFICATION_ID = 2472;

    public TrackingWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // Tracking volontairement arrêté → rien à faire (le worker reste enregistré
        // mais inactif, il sera annulé par stop()). Le compteur d'échecs n'est pas
        // remis à zéro ici : l'arrêt volontaire n'a rien à voir avec un redémarrage.
        if (!prefs.getBoolean(PREF_TRACKING_ACTIVE, false)) {
            return Result.success();
        }

        // Le service tourne déjà → tout va bien : on remet le compteur d'échecs à zéro
        // (un redémarrage réussi — par ce worker ou autrement — clôt la série d'échecs)
        // et on ne relance rien.
        if (LocationForegroundService.isRunning) {
            resetFailureCount(prefs);
            return Result.success();
        }

        // Garde-fou : sans permission de localisation, un foreground service de
        // type "location" ne servirait à rien ; on ne le relance pas (le flux JS
        // watchPosition reste le repli, et le user repassera par start()).
        // Ce cas est EXCLU du compteur d'échecs : relancer ne changerait rien tant
        // que la permission n'est pas redonnée par l'utilisateur.
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return Result.success();
        }

        // Le service est MORT alors qu'un tracking devrait être actif : c'est une
        // interruption subie (mort du process par le système, ou force-stop partiel
        // non détectable en temps réel). On la MARQUE explicitement — jamais
        // silencieuse : le JS la signalera au backend au prochain lancement
        // (getInterruptionInfo → POST /tracking/report-interruption). Le redémarrage
        // ci-dessous est tenté, et le marqueur subsiste même si le process meurt à
        // nouveau avant que le JS n'ait pu le lire.
        LocationForegroundService.markTrackingInterrupted(context, "watchdog_detected_dead");

        try {
            Intent intent = new Intent(context, LocationForegroundService.class);
            intent.setAction(LocationForegroundService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
            // Le startForegroundService a été accepté (aucune exception). L'état isRunning
            // peut mettre quelques instants à passer à true (onStartCommand) ; on ne le
            // vérifie pas ici — le prochain cycle confirmera. On laisse le compteur tel
            // quel : s'il est > 0, un succès durable le remettra à zéro au cycle suivant.
            return Result.success();
        } catch (Exception e) {
            // Par exemple IllegalStateException si le worker tourne alors que l'app est
            // forcée en arrière-plan (restrictions de démarrage en arrière-plan Android 12+).
            // Jamais silencieux : log explicite + compteur + notification chauffeur si seuil.
            Log.e(TAG, "Echec du redemarrage du service de localisation", e);
            int failures = incrementFailureCount(prefs);
            if (failures >= FAILURE_NOTIFICATION_THRESHOLD) {
                notifyDriver(context);
            }
            // retry() → WorkManager applique son backoff exponentiel par défaut et retente
            // plus vite qu'au prochain cycle de 15 min, au lieu d'attendre le succès muet.
            return Result.retry();
        }
    }

    private int incrementFailureCount(SharedPreferences prefs) {
        int failures = prefs.getInt(PREF_RESTART_FAILURES, 0) + 1;
        prefs.edit().putInt(PREF_RESTART_FAILURES, failures).apply();
        return failures;
    }

    private void resetFailureCount(SharedPreferences prefs) {
        int current = prefs.getInt(PREF_RESTART_FAILURES, 0);
        if (current != 0) {
            prefs.edit().putInt(PREF_RESTART_FAILURES, 0).apply();
            Log.i(TAG, "Service actif — compteur d'echecs de redemarrage remis a zero (etait: " + current + ")");
        }
    }

    /** Notifie le chauffeur que le suivi a rencontré un problème persistant. */
    private void notifyDriver(Context context) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel channel = new NotificationChannel(
                    ALERT_CHANNEL_ID,
                    ALERT_CHANNEL_NAME,
                    NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Alerte de suivi GPS (probleme de redemarrage du service)");
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.createNotificationChannel(channel);
                }
            }

            Intent notificationIntent = new Intent(context, MainActivity.class);
            PendingIntent contentIntent = PendingIntent.getActivity(
                context,
                0,
                notificationIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, ALERT_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_location)
                .setContentTitle(context.getString(R.string.watchdog_alert_title))
                .setContentText(context.getString(R.string.watchdog_alert_text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(contentIntent);

            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(ALERT_NOTIFICATION_ID, builder.build());
            }
        } catch (Exception ex) {
            // La notification est secondaire : une erreur ici ne doit pas casser le worker.
            Log.e(TAG, "Impossible d'emettre la notification d'alerte suivi", ex);
        }
    }
}
