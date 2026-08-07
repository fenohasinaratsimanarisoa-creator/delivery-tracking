package com.logitrack.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.annotation.NonNull;
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
 */
public class TrackingWatchdogWorker extends Worker {

    public static final String WATCHDOG_WORK_NAME = "logitrack_tracking_watchdog";
    public static final String PREFS_NAME = "logitrack_tracking";
    public static final String PREF_TRACKING_ACTIVE = "tracking_should_be_active";

    public TrackingWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        // Tracking volontairement arrêté → rien à faire (le worker reste enregistré
        // mais inactif, il sera annulé par stop()).
        if (!prefs.getBoolean(PREF_TRACKING_ACTIVE, false)) {
            return Result.success();
        }

        // Le service tourne déjà → tout va bien, ne rien relancer.
        if (LocationForegroundService.isRunning) {
            return Result.success();
        }

        // Garde-fou : sans permission de localisation, un foreground service de
        // type "location" ne servirait à rien ; on ne le relance pas (le flux JS
        // watchPosition reste le repli, et le user repassera par start()).
        if (androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return Result.success();
        }

        try {
            Intent intent = new Intent(context, LocationForegroundService.class);
            intent.setAction(LocationForegroundService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception e) {
            // Par exemple IllegalStateException si le worker tourne alors que l'app
            // est forcée en arrière-plan : on ne retente pas maintenant, WorkManager
            // re-exécutera le worker au prochain cycle.
            return Result.success();
        }
        return Result.success();
    }
}
