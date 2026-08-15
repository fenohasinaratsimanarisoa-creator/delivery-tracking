package com.logitrack.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

/**
 * Redémarrage one-shot du foreground service de localisation via WorkManager.
 *
 * Troisième chemin indépendant de la cascade anti-interruption :
 *   1. startService direct (onTaskRemoved) — le plus rapide quand il passe ;
 *   2. AlarmManager ~1 s (onTaskRemoved) — exempt des restrictions de démarrage
 *      en arrière-plan pour les PendingIntent de service ;
 *   3. CE WORKER (WorkManager one-shot ~2 s) — persistant sur disque et fiabilisé
 *      par le système, SANS contrainte réseau (le tracking doit reprendre même en
 *      zone blanche / hors ligne), replanifié par WorkManager après reboot.
 *
 * Garde-fous (identiques au watchdog) : ne relance que si un tracking est encore
 * volontairement actif (SharedPreferences tracking_should_be_active = true) et si
 * la permission de localisation est toujours accordée (un foreground service de
 * type "location" sans permission ne servirait à rien).
 */
public class ServiceRestartWorker extends Worker {

    public static final String RESTART_WORK_NAME = "logitrack_tracking_restart_oneshot";

    private static final String TAG = "ServiceRestart";

    public ServiceRestartWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();

        // Un tracking volontairement arrêté entre la planification et l'exécution du
        // worker (fenêtre de ~2 s) → ne rien relancer.
        SharedPreferences prefs = context.getSharedPreferences(
            TrackingWatchdogWorker.PREFS_NAME,
            Context.MODE_PRIVATE
        );
        if (!prefs.getBoolean(TrackingWatchdogWorker.PREF_TRACKING_ACTIVE, false)) {
            return Result.success();
        }

        // Le service tourne déjà (un des deux autres chemins a gagné la course) → no-op.
        if (LocationForegroundService.isRunning) {
            return Result.success();
        }

        if (androidx.core.content.ContextCompat.checkSelfPermission(
                context, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
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
            return Result.success();
        } catch (Exception e) {
            // Restriction de démarrage en arrière-plan persistante : le watchdog
            // périodique (15 min) reste le filet final. On ne marque PAS d'interruption
            // ici (l'échec est transitoire et retenté), on logge simplement.
            Log.w(TAG, "One-shot restart blocked: " + e.getMessage());
            return Result.failure();
        }
    }
}
