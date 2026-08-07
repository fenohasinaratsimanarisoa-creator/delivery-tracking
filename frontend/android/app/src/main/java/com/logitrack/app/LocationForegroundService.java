package com.logitrack.app;

import android.Manifest;
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
 */
public class LocationForegroundService extends Service {

    public static final String ACTION_START = "com.logitrack.app.action.START_LOCATION";
    public static final String ACTION_STOP = "com.logitrack.app.action.STOP_LOCATION";
    public static final String CHANNEL_ID = "logitrack_location";
    public static final int NOTIFICATION_ID = 2471;

    /** Intervalle cible d'acquisition GPS : 5 s. */
    private static final long LOCATION_INTERVAL_MS = 5000L;
    /** Intervalle minimal accepté : 3 s. */
    private static final long LOCATION_FASTEST_INTERVAL_MS = 3000L;

    public static boolean isRunning = false;

    /** Récepteurs statiques des positions acquises (le plugin Capacitor s'y abonne). */
    public interface LocationSink {
        void onLocationUpdate(Location location);
    }

    private static final List<LocationSink> LOCATION_SINKS = new CopyOnWriteArrayList<>();

    /** Dernière position acquise, pour qu'un abonné tardif reçoive l'état courant. */
    private static volatile Location latestLocation = null;

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
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopLocationUpdates();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        startInForeground();
        startLocationUpdates();
        return START_STICKY;
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
     * Démarre l'acquisition GPS via FusedLocationProviderClient : haute précision,
     * intervalle 5 s (min 3 s). Le callback tourne sur le main looper : c'est ce
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

    private Notification buildNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_location)
            .setContentTitle(getString(R.string.location_notification_title))
            .setContentText(getString(R.string.location_notification_text))
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
        isRunning = false;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
