package com.logitrack.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Service foreground de type "location" : il maintient le process vivant
 * (non gelé par Doze/App Standby) et acquiert lui-même les positions via
 * FusedLocationProviderClient (Google Play Services).
 *
 * POURQUOI CETTE ARCHITECTURE CORRIGE LE PROBLÈME :
 * Avant, le service ne faisait que maintenir le process en vie : l'acquisition
 * réelle se faisait en JS via navigator.geolocation.watchPosition, exécuté par
 * la WebView. Or quand l'app passe en arrière-plan / écran verrouillé, Android
 * suspend la WebView (paint stop / throttle) et watchPosition ne produit plus
 * rien. Ici, le service natif utilise FusedLocationProviderClient, qui est un
 * client du framework de localisation Android (pas de la WebView) : il continue
 * de recevoir des positions tant que le process vit, indépendamment du cycle
 * de vie de la WebView. Ces positions sont ensuite transmises au JS via le
 * plugin Capacitor (notifyListeners), qui les fait entrer dans le même pipeline
 * Kalman / envoi socket / file offline existant — sans dupliquer cette logique
 * en Java.
 *
 * Le pont vers le JS est une liste statique de "sinks" (LocationSink) :
 * BackgroundLocationPlugin s'abonne via addLocationSink()/removeLocationSink().
 * Le callback statique est volontairement simple (pas de LocalBroadcastManager,
 * déprécié) et partage le même process, donc pas besoin de IPC.
 *
 * ROBUSTESSE (anti-kill) :
 *  - START_STICKY : si Android tue le service sous pression mémoire, il est
 *    recréé automatiquement (onStartCommand rappelé avec un intent null).
 *  - PARTIAL_WAKE_LOCK maintenu pendant toute la session de tracking : le CPU
 *    continue de tourner en écran verrouillé / Doze (le réseau et la géoloc
 *    restent actifs). Libéré à l'arrêt volontaire (ACTION_STOP) et en onDestroy.
 *  - onTaskRemoved (app balayée des tâches récentes) : redémarrage programmé
 *    via AlarmManager (secours) + startService direct, car certains OEM ne
 *    relancent pas un foreground service balayé des recents.
 *  - BootReceiver : relance le service après un reboot téléphone (lui seul
 *    survit à un reboot ; START_STICKY ne couvre que les morts de process).
 *  - TrackingWatchdogWorker (WorkManager, toutes les 15 min) : filet de
 *    sécurité final si le process meurt malgré tout.
 */
public class LocationForegroundService extends Service {

    public static final String ACTION_START = "com.logitrack.app.action.START_LOCATION";
    public static final String ACTION_STOP = "com.logitrack.app.action.STOP_LOCATION";
    public static final String CHANNEL_ID = "logitrack_location";
    public static final int NOTIFICATION_ID = 2471;

    /**
     * Cadence d'acquisition GPS — compromis fluidité/batterie pour une flotte
     * professionnelle. Alignées sur le JS (useDriverTracking.ts : INTERVAL_FAST
     * et LOCATION_FASTEST_INTERVAL_MS) pour un rendu temps réel fluide type
     * Google Maps. NE PAS descendre sous 1000ms : la précision GPS civile
     * (~5-10m, même fixes) et le coût batterie rendraient la cadence sans bénéfice.
     */
    private static final long LOCATION_INTERVAL_MS = 3000L;
    private static final long LOCATION_FASTEST_INTERVAL_MS = 2000L;

    /** Délai du redémarrage de secours après un balayage des tâches récentes. */
    private static final long TASK_REMOVED_RESTART_DELAY_MS = 1000L;

    public static boolean isRunning = false;

    /** Récepteurs statiques des positions acquises (le plugin Capacitor s'y abonne). */
    public interface LocationSink {
        void onLocationUpdate(Location location);
    }

    private static final List<LocationSink> LOCATION_SINKS = new CopyOnWriteArrayList<>();

    /** Dernière position acquise, pour qu'un abonné tardif reçoive l'état courant. */
    private static volatile Location latestLocation = null;

    /**
     * Texte de statut courant affiché dans la notification persistante. Mis à
     * jour depuis le JS via BackgroundLocationPlugin.updateTrackingStatus()
     * (état réel du suivi : actif / hors ligne avec file locale / en pause).
     */
    private static volatile String notificationStatusText = null;

    /** WakeLock partiel : maintient le CPU éveillé pendant la session de tracking. */
    private static volatile PowerManager.WakeLock wakeLock = null;

    public static void addLocationSink(LocationSink sink) {
        if (sink != null) {
            LOCATION_SINKS.add(sink);
        }
    }

    public static void removeLocationSink(LocationSink sink) {
        if (sink != null) {
            LOCATION_SINKS.remove(sink);
        }
    }

    public static Location getLatestLocation() {
        return latestLocation;
    }

    /**
     * Met à jour le texte de statut de la notification persistante (appelé par
     * le JS via le plugin : "Suivi actif", "Hors ligne — 12 positions en
     * attente", "Suivi en pause"…). No-op si le service n'est pas en cours
     * d'exécution (le texte sera pris en compte à la prochaine création).
     */
    public static void updateNotificationStatus(String statusText) {
        notificationStatusText = statusText;
        LocationForegroundService instance = runningInstance;
        if (instance != null) {
            instance.refreshNotification();
        }
    }

    /** Instance courante du service (pour rafraîchir la notification depuis un contexte statique). */
    private static volatile LocationForegroundService runningInstance = null;

    private FusedLocationProviderClient fusedLocationClient;
    private LocationRequest locationRequest;
    private LocationCallback locationCallback;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        runningInstance = this;
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopLocationUpdates();
            releaseWakeLock();
            stopForeground(true);
            stopSelf();
            isRunning = false;
            runningInstance = null;
            return START_NOT_STICKY;
        }
        startInForeground();
        acquireWakeLock();
        startLocationUpdates();
        return START_STICKY;
    }

    /**
     * App balayée des tâches récentes : certains constructeurs (MIUI, ColorOS…)
     * tuent le process même pour un foreground service. On tente un redémarrage
     * immédiat (startService — l'app est encore dans son propre process ici) ET
     * on programme un secours AlarmManager ~1 s plus tard : si le premier
     * startService est bloqué par les restrictions de démarrage en arrière-plan
     * (Android 12+), l'alarme — exempte de ces restrictions pour les
     * PendingIntent de service — relancera le service.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        try {
            Intent restart = new Intent(this, LocationForegroundService.class);
            restart.setAction(ACTION_START);

            // 1) Tentative directe (la plus fiable quand elle passe).
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    startForegroundService(restart);
                } else {
                    startService(restart);
                }
            } catch (Exception ignored) {
                // Restrictions de démarrage en arrière-plan : le secours AlarmManager
                // ci-dessous prend le relais.
            }

            // 2) Secours AlarmManager (one-shot, ~1 s).
            PendingIntent pending = PendingIntent.getService(
                this,
                0,
                restart,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
            AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.set(AlarmManager.RTC, System.currentTimeMillis() + TASK_REMOVED_RESTART_DELAY_MS, pending);
            }
        } catch (Exception e) {
            // Jamais bloquant : le watchdog WorkManager (15 min) reste le filet final.
        }
    }

    private void startInForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        isRunning = true;
    }

    /**
     * WakeLock PARTIAL : garde le CPU éveillé (mais PAS l'écran) pendant toute la
     * session de tracking. Sans lui, Android peut suspendre le process en Doze
     * même pour un foreground service, ce qui gèle l'acquisition GPS et le réseau.
     * Libéré à l'arrêt volontaire et en onDestroy (pas de fuite → pas de surconsommation
     * batterie après l'arrêt du tracking). Ré-acquis à chaque redémarrage du service
     * (START_STICKY, onTaskRemoved, BootReceiver, watchdog) : le tracking ne doit
     * jamais s'interrompre.
     */
    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            return;
        }
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null) {
            return;
        }
        try {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "logitrack:tracking");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Exception e) {
            // WakeLock refusé (rare) : on continue sans — le foreground service
            // reste la protection principale.
            wakeLock = null;
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
            } catch (Exception ignored) {
            }
            wakeLock = null;
        }
    }

    /**
     * Démarre l'acquisition GPS via FusedLocationProviderClient : haute précision,
     * intervalle 3 s (min 2 s). Le callback tourne sur le main looper : c'est ce
     * thread que BackgroundLocationPlugin utilisera pour notifyListeners (exigé
     * par le bridge Capacitor). Aucune dépendance à la WebView ici.
     */
    private void startLocationUpdates() {
        // Garde-fou : sans permission, on ne tente rien (le flow de demande reste
        // entièrement côté BackgroundLocationPlugin). Le service existe simplement
        // pour maintenir le process ; le JS garde son repli watchPosition.
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        // Évite des callbacks dupliqués si onStartCommand est rappelé.
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
            .setMinUpdateIntervalMillis(LOCATION_FASTEST_INTERVAL_MS)
            .build();
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) {
                    return;
                }
                Location location = locationResult.getLastLocation();
                if (location == null) {
                    return;
                }
                latestLocation = location;
                for (LocationSink sink : LOCATION_SINKS) {
                    sink.onLocationUpdate(location);
                }
            }
        };
        fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
    }

    private void stopLocationUpdates() {
        if (fusedLocationClient != null && locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        locationCallback = null;
        latestLocation = null;
    }

    /** Rafraîchit la notification persistante (appelé au démarrage et à chaque update de statut JS). */
    private void refreshNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, buildNotification());
            }
        } catch (Exception e) {
            // La notification est secondaire : un échec ici ne doit jamais tuer le service.
        }
    }

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        // Texte de statut par défaut ; remplacé par le JS (updateTrackingStatus)
        // avec l'état RÉEL du suivi (actif / hors ligne / pause).
        String statusText = notificationStatusText != null
            ? notificationStatusText
            : getString(R.string.location_notification_text);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_location)
            .setContentTitle(getString(R.string.location_notification_title))
            .setContentText(statusText)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setShowWhen(false)
            .setContentIntent(contentIntent);

        return builder.build();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.location_notification_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.location_notification_channel_desc));
        channel.setShowBadge(false);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.createNotificationChannel(channel);
        }
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        releaseWakeLock();
        isRunning = false;
        runningInstance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
