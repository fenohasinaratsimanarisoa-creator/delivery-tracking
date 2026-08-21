package com.logitrack.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.TimeUnit;

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

    /**
     * Cadence d'acquisition RALENTIE à l'arrêt (véhicule immobile depuis un moment —
     * livraison en cours de déchargement, pause, stationnement). Le coût batterie d'un
     * fix GPS haute précision est quasi constant PAR FIX : à l'arrêt, une position
     * toutes les 3 s n'apporte aucune information utile (le véhicule ne bouge pas) mais
     * consomme autant qu'en mouvement. On passe à 20 s après ARRÊT_PROLONGÉ (délai de
     * stabilisation) pour tenir une journée de 8 h sans recharge. Dès que le véhicule
     * repart (vitesse > seuil), on repasse immédiatement à 3 s.
     */
    private static final long LOCATION_INTERVAL_SLOW_MS = 20_000L;
    private static final long LOCATION_FASTEST_SLOW_MS = 15_000L;

    /** Délai du redémarrage de secours après un balayage des tâches récentes. */
    private static final long TASK_REMOVED_RESTART_DELAY_MS = 1000L;

    public static boolean isRunning = false;

    /** Récepteurs statiques des positions acquises (le plugin Capacitor s'y abonne). */
    public interface LocationSink {
        void onLocationUpdate(Location location);
    }

    /** Récepteur d'alerte batterie critique (le plugin Capacitor s'y abonne). */
    public interface BatteryCriticalSink {
        void onBatteryCritical(int levelPercent, Location lastLocation);
    }

    private static final List<LocationSink> LOCATION_SINKS = new CopyOnWriteArrayList<>();
    private static final List<BatteryCriticalSink> BATTERY_SINKS = new CopyOnWriteArrayList<>();

    /** true quand l'arrêt est VOLONTAIRE (ACTION_STOP) : onDestroy ne doit alors
     *  ni marquer d'interruption, ni planifier de redémarrage. */
    private static volatile boolean voluntarilyStopped = false;

    /** Reçoit ACTION_BATTERY_LOW : avant extinction probable, capture la dernière
     *  position et prévient le JS (plugin) qui enverra une dernière position + un
     *  statut "batterie critique" au backend pour que le dispatcher voie la cause
     *  probable de l'interruption au lieu d'un silence inexpliqué. */
    private final BroadcastReceiver batteryLowReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            try {
                int level = 0;
                boolean isLow = false;
                if (intent != null && intent.getAction() != null) {
                    if (Intent.ACTION_BATTERY_LOW.equals(intent.getAction())) {
                        isLow = true;
                        level = 15;
                    } else if (Intent.ACTION_BATTERY_CHANGED.equals(intent.getAction())) {
                        level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                        int scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                        if (level >= 0 && scale > 0) level = Math.round(level * 100f / scale);
                        // ACTION_BATTERY_CHANGED est sticky et reçu à CHAQUE variation :
                        // on n'émet que sous le seuil critique réel (≤ 20 %), une fois par
                        // palier de 5 % pour ne pas spammer le backend.
                        isLow = level <= 20;
                    }
                }
                if (!isLow) return;
                Location last = latestLocation;
                for (BatteryCriticalSink sink : BATTERY_SINKS) {
                    sink.onBatteryCritical(level, last);
                }
                // Met à jour la notification : le chauffeur VOIT la cause probable
                // (batterie critique) plutôt qu'une notification de suivi normale.
                notificationStatusText = "⚠ Batterie critique (" + level + "%) — le suivi va s'interrompre";
                LocationForegroundService instance = runningInstance;
                if (instance != null) instance.refreshNotification();
            } catch (Exception ignored) {
                // Un échec ici ne doit jamais casser le service.
            }
        }
    };

    public static void addBatteryCriticalSink(BatteryCriticalSink sink) {
        if (sink != null) {
            BATTERY_SINKS.add(sink);
        }
    }

    public static void removeBatteryCriticalSink(BatteryCriticalSink sink) {
        if (sink != null) {
            BATTERY_SINKS.remove(sink);
        }
    }

    /**
     * Marque une interruption NON volontaire du tracking dans SharedPreferences :
     * lu par le JS au prochain lancement (getInterruptionInfo) qui le signale au
     * backend → notification dashboard "tracking interrompu à HH:MM". Écrit par
     * onDestroy (mort par le système) et par le watchdog (process déjà mort).
     * Un force-stop UTILISATEUR tue le process sans aucun callback : seul le
     * redémarrage suivant de l'app peut alors détecter l'interruption (marqueur
     * d'âge dans start()) — c'est la limite documentée d'Android, aucune app ne
     * peut recevoir d'événement pendant un force-stop.
     */
    public static void markTrackingInterrupted(Context context, String reason) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(
                TrackingWatchdogWorker.PREFS_NAME,
                Context.MODE_PRIVATE
            );
            prefs.edit()
                .putLong(TrackingWatchdogWorker.PREF_TRACKING_INTERRUPTED_AT, System.currentTimeMillis())
                .putString(TrackingWatchdogWorker.PREF_TRACKING_INTERRUPTED_REASON, reason)
                .apply();
        } catch (Exception ignored) {
        }
    }

    /** Dernière position acquise, pour qu'un abonné tardif reçoive l'état courant. */
    private static volatile Location latestLocation = null;

    // --- Fallback HTTP natif (Option B, audit 21/08/2026) ---
    /** Horodatage du dernier ACK JS (notifyListeners traité par le pipeline JS). */
    private static volatile long lastJsAckTime = 0;
    /** ID du véhicule courant (pour le fallback natif). */
    private static volatile String nativeVehicleId = null;
    /** ID de la livraison courante (pour le fallback natif). */
    private static volatile String nativeDeliveryId = null;

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

    // --- Fallback HTTP natif :ACK JS + contexte véhicule/livraison ---

    /**
     * Notifie le service qu'un ACK JS a été traité (le pipeline JS a reçu et
     * traité une position via notifyListeners). Utilisé par le fallback natif
     * pour détecter quand la WebView est silencieuse depuis > 2 min.
     */
    public static void markJsAck() {
        lastJsAckTime = System.currentTimeMillis();
    }

    /** Met à jour les IDs véhicule/livraison pour le fallback natif. */
    public static void setNativeContext(String vehicleId, String deliveryId) {
        nativeVehicleId = vehicleId;
        nativeDeliveryId = deliveryId;
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

    /** Cadence actuelle : true = mode lent (à l'arrêt), false = mode rapide (3 s). */
    private boolean slowAcquisitionMode = false;
    /**
     * Détecteur de mouvement à 3 états (MOVING_CONFIRMED / STATIONARY_CONFIRMED /
     * UNKNOWN) : remplace la détection binaire hasSpeed() qui traitait à tort
     * comme « arrêt » les fixes sans vitesse fiable (signal GPS dégradé : tunnel,
     * canyon urbain, couvert dense) et basculait en cadence lente pendant un
     * déplacement réel. PURE JAVA : testé par MotionStateDetectorTest.java.
     */
    private final MotionStateDetector motionDetector = new MotionStateDetector();

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        // Batterie critique (ACTION_BATTERY_LOW) + sticky ACTION_BATTERY_CHANGED pour
        // relire le niveau exact. Enregistrement dynamique : le receiver ne survit pas
        // à un reboot (BOOT_COMPLETED repart de zéro — inutile de re-écouter avant).
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_BATTERY_LOW);
            filter.addAction(Intent.ACTION_BATTERY_CHANGED);
            registerReceiver(batteryLowReceiver, filter);
        } catch (Exception e) {
            // Receiver refusé (rare, Android 14+ contexte partiel) : on continue sans —
            // la détection batterie est un bonus, pas un prérequis au tracking.
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        runningInstance = this;
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            voluntarilyStopped = true;
            stopLocationUpdates();
            releaseWakeLock();
            stopForeground(true);
            stopSelf();
            isRunning = false;
            runningInstance = null;
            return START_NOT_STICKY;
        }
        // Toute (ré)exécution avec ACTION_START = session de tracking légitime : un
        // arrêt ultérieur (onDestroy) ne sera PAS marqué comme interruption volontaire.
        voluntarilyStopped = false;
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

            // 3) Secours WorkManager one-shot (~2 s, SANS contrainte réseau) : troisième
            // chemin indépendant de redémarrage. WorkManager est persistant sur disque et
            // fiabilisé par le système (même après une mort de process), contrairement à
            // l'alarme (volatile) et au startService direct (restrictions de démarrage en
            // arrière-plan Android 12+). La cascade complète : startService direct →
            // AlarmManager 1 s → WorkManager 2 s → watchdog périodique 15 min.
            OneTimeWorkRequest restartWork = new OneTimeWorkRequest.Builder(
                ServiceRestartWorker.class
            )
                .setInitialDelay(TASK_REMOVED_RESTART_DELAY_MS + 1000L, TimeUnit.MILLISECONDS)
                .build();
            WorkManager.getInstance(this)
                .enqueueUniqueWork(
                    ServiceRestartWorker.RESTART_WORK_NAME,
                    ExistingWorkPolicy.REPLACE,
                    restartWork
                );
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
        // Référence de départ du compteur d'arrêt : un véhicule immobile DÈS le début
        // (livraison en cours de chargement le matin) doit lui aussi passer en cadence
        // lente après le délai de stabilisation — sans dernier mouvement connu, la
        // condition lastMovingTimestamp > 0 resterait fausse et le mode lent ne
        // s'activerait jamais.
        motionDetector.markStart(System.currentTimeMillis());
        slowAcquisitionMode = false;
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
                // LocationResult peut regrouper PLUSIEURS fixes en un seul
                // callback (économie d'énergie, Doze, rattrapage du provider).
                // getLastLocation() se limiterait au plus récent et perdrait
                // silencieusement les autres : chaque point du lot est donc
                // livré individuellement à chaque sink (le dernier de la liste
                // étant le plus récent, il devient latestLocation).
                for (Location loc : locationResult.getLocations()) {
                    latestLocation = loc;
                    for (LocationSink sink : LOCATION_SINKS) {
                        sink.onLocationUpdate(loc);
                    }
                    // --- Fallback HTTP natif (Option B, audit 21/08/2026) ---
                    // Si le JS est silencieux depuis > 2 min (la WebView est gelée),
                    // on envoie la position directement via HTTP pour ne pas la perdre.
                    // Ne s'active que si lastJsAckTime > 0 (le JS a déjà communiqué
                    // au moins une fois) et si le token/API URL sont disponibles.
                    if (lastJsAckTime > 0
                        && NativeHttpFallback.shouldActivate(lastJsAckTime)
                        && nativeVehicleId != null && !nativeVehicleId.isEmpty()) {
                        NativeHttpFallback.sendPosition(
                            getApplicationContext(), loc, nativeVehicleId, nativeDeliveryId
                        );
                    }
                }
                adaptAcquisitionInterval(location);
            }
        };
        fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
    }

    /**
     * ACQUISITION ADAPTATIVE (économie batterie 8 h) : à l'arrêt CONFIRMÉ et
     * prolongé (> 90 s sans déplacement), on ralentit la demande de fixes à 20 s
     * (au lieu de 3 s) — le fix GPS coûte la même énergie à l'arrêt qu'en
     * mouvement, mais n'apporte aucune information utile. Dès que le véhicule
     * repart, retour immédiat à 3 s. La transition se fait en re-requestant
     * FusedLocationProviderClient avec un nouveau LocationRequest : le même
     * callback remplace la demande active (aucun callback dupliqué).
     *
     * DÉTECTION À 3 ÉTATS (voir MotionStateDetector) : la détection binaire
     * historique (isMoving = hasSpeed() && speed > seuil) considérait à tort un
     * véhicule à l'arrêt quand le provider ne fournissait PAS de vitesse fiable
     * pour un fix précis (signal GPS dégradé : tunnel, canyon urbain, couvert
     * dense, cold-fix après un trou de signal). Après 90 s de ce type de fixes,
     * le service basculait à tort en cadence lente (20 s) — précisément dans les
     * zones où le risque de trou de trace est le plus élevé. Désormais :
     *  - MOVING_CONFIRMED (vitesse fiable > seuil) rafraîchit lastMovingTimestamp ;
     *  - STATIONARY_CONFIRMED (vitesse fiable ≈ 0, OU pas de vitesse mais position
     *    immobile < 15 m sur ≥ 2 fixes consécutifs) est la SEULE condition qui
     *    compte vers le mode lent ;
     *  - UNKNOWN (pas de vitesse + déplacement, ou premier fix) NE déclenche
     *    JAMAIS le mode lent : un signal durablement dégradé au point de ne
     *    jamais confirmer l'arrêt est probablement synonyme de déplacement en
     *    zone difficile, où la cadence rapide est justement la plus utile.
     */
    private void adaptAcquisitionInterval(Location location) {
        boolean shouldBeSlow = motionDetector.shouldBeSlow(
            location.hasSpeed(),
            location.hasSpeed() ? location.getSpeed() : 0f,
            location.getLatitude(),
            location.getLongitude(),
            System.currentTimeMillis()
        );

        if (shouldBeSlow == slowAcquisitionMode) {
            return; // aucun changement de cadence
        }
        slowAcquisitionMode = shouldBeSlow;
        try {
            locationRequest = new LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                shouldBeSlow ? LOCATION_INTERVAL_SLOW_MS : LOCATION_INTERVAL_MS
            )
                .setMinUpdateIntervalMillis(
                    shouldBeSlow ? LOCATION_FASTEST_SLOW_MS : LOCATION_FASTEST_INTERVAL_MS
                )
                .build();
            fusedLocationClient.requestLocationUpdates(
                locationRequest,
                locationCallback,
                Looper.getMainLooper()
            );
        } catch (Exception e) {
            // Échec de re-request (rare) : on conserve la cadence précédente, le
            // prochain fix retentera.
        }
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
            // Texte dissuasif PERMANENT (visible en collapsed) : réduit le risque de
            // fermeture manuelle accidentelle de l'app par le chauffeur.
            .setSubText(getString(R.string.location_notification_subtext))
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // Priorité haute : minimise le risque que le système classe ce service comme
            // "à faible priorité, tuable en premier" sous pression mémoire. onlyAlertOnce
            // évite le son/vibration à CHAQUE rafraîchissement de statut (le canal est
            // IMPORTANCE_HIGH) — le service ne sonne qu'une fois, au démarrage du tracking.
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(contentIntent);

        return builder.build();
    }

    private void createNotificationChannel() {
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.location_notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH
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
        try {
            unregisterReceiver(batteryLowReceiver);
        } catch (Exception ignored) {
            // Receiver déjà désinscrit (arrêt multiple) — non bloquant.
        }
        stopLocationUpdates();
        releaseWakeLock();

        // Interruption NON volontaire du tracking (mort par le système sous pression
        // mémoire, redémarrage, ou kill partiel) : on le MARQUE pour que le JS le
        // signale au backend au prochain lancement (notification dashboard). Si un
        // tracking était en cours et que l'arrêt n'est pas un ACTION_STOP, c'est une
        // interruption subie — jamais silencieuse.
        if (!voluntarilyStopped) {
            SharedPreferences prefs = getSharedPreferences(
                TrackingWatchdogWorker.PREFS_NAME,
                Context.MODE_PRIVATE
            );
            if (prefs.getBoolean(TrackingWatchdogWorker.PREF_TRACKING_ACTIVE, false)) {
                markTrackingInterrupted(this, "service_killed");
            }
            // Et on planifie un redémarrage en cascade (WorkManager one-shot) : si le
            // système a tué le service MAIS pas le process, le tracking reprend vite.
            OneTimeWorkRequest restartWork = new OneTimeWorkRequest.Builder(
                ServiceRestartWorker.class
            )
                .setInitialDelay(2_000L, TimeUnit.MILLISECONDS)
                .build();
            try {
                WorkManager.getInstance(this)
                    .enqueueUniqueWork(
                        ServiceRestartWorker.RESTART_WORK_NAME,
                        ExistingWorkPolicy.REPLACE,
                        restartWork
                    );
            } catch (Exception ignored) {
            }
        }

        isRunning = false;
        runningInstance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
