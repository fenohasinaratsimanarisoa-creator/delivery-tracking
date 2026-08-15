package com.logitrack.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

/**
 * Redémarre le tracking après un reboot du téléphone SANS que le chauffeur ait
 * à rouvrir l'app.
 *
 * Un foreground service ne survit pas à un reboot : le système tue tout au
 * shutdown, et START_STICKY ne s'applique qu'aux morts de process, pas aux
 * redémarrages du téléphone. Seul un receiver déclaré pour BOOT_COMPLETED peut
 * relancer le service à froid.
 *
 * Conditions de redémarrage (toutes requises) :
 *  - SharedPreferences "tracking_should_be_active" = true : le chauffeur avait
 *    un tracking en cours avant le reboot (et ne l'a pas arrêté volontairement).
 *    Cette préférence est écrite par BackgroundLocationPlugin.start()/stop() et
 *    survit au reboot (SharedPreferences = fichier sur disque).
 *  - Permission ACCESS_FINE_LOCATION encore accordée (un foreground service de
 *    type "location" sans permission ne servirait à rien).
 *
 * NB : si le process venait à être tué SANS reboot (low memory, force-stop
 * partiel), c'est TrackingWatchdogWorker (WorkManager, toutes les 15 min) qui
 * prend le relais — ce receiver ne couvre QUE le cas reboot.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "LogiTrackBoot";

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            String action = intent == null ? null : intent.getAction();
            boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action);
            if (!isBoot) {
                return;
            }

            SharedPreferences prefs = context.getSharedPreferences(
                TrackingWatchdogWorker.PREFS_NAME,
                Context.MODE_PRIVATE
            );
            if (!prefs.getBoolean(TrackingWatchdogWorker.PREF_TRACKING_ACTIVE, false)) {
                // Aucun tracking en cours avant le reboot : rien à relancer.
                return;
            }

            if (androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    android.Manifest.permission.ACCESS_FINE_LOCATION
                ) != PackageManager.PERMISSION_GRANTED) {
                Log.w(TAG, "Reboot: tracking actif mais permission location refusée — pas de redémarrage");
                return;
            }

            Intent serviceIntent = new Intent(context, LocationForegroundService.class);
            serviceIntent.setAction(LocationForegroundService.ACTION_START);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            Log.i(TAG, "Reboot détecté — foreground service de localisation relancé");

            // Le watchdog WorkManager est aussi replanifié par le système après un
            // reboot (persistance disque) : il confirmera l'état au prochain cycle.
        } catch (Exception e) {
            // Un échec ici ne doit jamais faire crasher le boot du téléphone.
            Log.e(TAG, "Échec du redémarrage du tracking après reboot", e);
        }
    }
}
