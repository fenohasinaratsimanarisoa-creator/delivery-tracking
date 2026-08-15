package com.logitrack.app;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * Pont natif pour le tracking en arrière-plan (Android uniquement).
 *
 *  - start(): démarre le foreground service de type "location" qui maintient le
 *    process vivant pendant l'écran verrouillé ET acquiert lui-même les positions
 *    via FusedLocationProviderClient (voir LocationForegroundService). Le plugin
 *    s'abonne aux positions du service (addLocationSink) et les transmet au JS via
 *    notifyListeners("locationUpdate", data) : useDriverTracking.ts les fait alors
 *    entrer dans son pipeline existant (Kalman, checkProximity, envoi socket, file
 *    offline) — la logique n'est pas dupliquée en Java.
 *  - requestPermissions(): flow Android 11+ en deux étapes : d'abord la
 *    permission de localisation "pendant l'utilisation" (fine/coarse), puis
 *    ACCESS_BACKGROUND_LOCATION ("toujours") une fois la première accordée.
 *  - getStatus(): état courant du service et des permissions.
 */
@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = {
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.ACCESS_FINE_LOCATION
        }),
        @Permission(alias = "backgroundLocation", strings = {
            Manifest.permission.ACCESS_BACKGROUND_LOCATION
        }),
        @Permission(alias = "notifications", strings = {
            Manifest.permission.POST_NOTIFICATIONS
        })
    }
)
public class BackgroundLocationPlugin extends Plugin {

    private static final String CALLBACK_LOCATION = "locationPermissionCallback";
    private static final String CALLBACK_BACKGROUND = "backgroundPermissionCallback";
    private static final String CALLBACK_BATTERY_EXEMPTION = "batteryOptimizationExemptionCallback";
    private static final String LOCATION_UPDATE_EVENT = "locationUpdate";

    /** Sink enregistré auprès du service pour recevoir les positions natives. */
    private LocationForegroundService.LocationSink locationSink;
    private boolean locationSinkRegistered = false;

    @PluginMethod
    public void start(PluginCall call) {
        if (!hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
            call.reject("LOCATION_PERMISSION_REQUIRED", "location_permission_required");
            return;
        }
        Context context = getContext();
        // S'abonne AVANT de démarrer le service pour ne rater aucune position.
        // Le sink est statique : il survivra à la (ré)création du service.
        subscribeToLocations();
        Intent intent = new Intent(context, LocationForegroundService.class);
        intent.setAction(LocationForegroundService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        // Watchdog : marque le tracking comme "devrait être actif" et planifie la
        // vérification périodique (15 min). KEEP : si une planification existe déjà,
        // on la laisse en place (idempotent, pas de reset du compteur WorkManager).
        setTrackingActive(true);
        scheduleWatchdog();
        JSObject ret = new JSObject();
        ret.put("running", isServiceRunning());
        ret.put("permissions", buildPermissionStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        unsubscribeFromLocations();
        setTrackingActive(false);
        cancelWatchdog();
        getContext().stopService(new Intent(getContext(), LocationForegroundService.class));
        JSObject ret = new JSObject();
        ret.put("running", false);
        ret.put("permissions", buildPermissionStatus());
        call.resolve(ret);
    }

    /** Persiste l'intention de tracking pour le watchdog (survit à la mort du process). */
    private void setTrackingActive(boolean active) {
        getContext()
            .getSharedPreferences(TrackingWatchdogWorker.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(TrackingWatchdogWorker.PREF_TRACKING_ACTIVE, active)
            .apply();
    }

    /**
     * Planifie TrackingWatchdogWorker toutes les 15 min (intervalle minimal
     * WorkManager). Tant que start() reste appelé, le worker redémarre le service
     * s'il meurt sans être arrêté volontairement.
     */
    private void scheduleWatchdog() {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            TrackingWatchdogWorker.class,
            15,
            TimeUnit.MINUTES
        ).build();
        WorkManager.getInstance(getContext())
            .enqueueUniquePeriodicWork(
                TrackingWatchdogWorker.WATCHDOG_WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
            );
    }

    private void cancelWatchdog() {
        WorkManager.getInstance(getContext())
            .cancelUniqueWork(TrackingWatchdogWorker.WATCHDOG_WORK_NAME);
    }

    /**
     * S'abonne aux positions acquises par LocationForegroundService et les pousse
     * vers le JS via notifyListeners("locationUpdate", ...). Le callback est reçu
     * sur le main looper (celui utilisé pour requestLocationUpdates), ce qui est
     * la condition requise par le bridge Capacitor pour notifyListeners.
     */
    private void subscribeToLocations() {
        if (locationSinkRegistered) {
            return;
        }
        locationSink = new LocationForegroundService.LocationSink() {
            @Override
            public void onLocationUpdate(Location location) {
                emitLocation(location);
            }
        };
        LocationForegroundService.addLocationSink(locationSink);
        locationSinkRegistered = true;
        // Si le service avait déjà une position (abonnement tardif), l'émettre
        // immédiatement pour que le JS reparte de l'état courant.
        Location latest = LocationForegroundService.getLatestLocation();
        if (latest != null) {
            emitLocation(latest);
        }
    }

    private void unsubscribeFromLocations() {
        if (locationSink != null) {
            LocationForegroundService.removeLocationSink(locationSink);
            locationSink = null;
        }
        locationSinkRegistered = false;
    }

    private void emitLocation(Location location) {
        JSObject data = new JSObject();
        data.put("latitude", location.getLatitude());
        data.put("longitude", location.getLongitude());
        data.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSObject.NULL);
        data.put("speed", location.hasSpeed() ? location.getSpeed() : JSObject.NULL);
        data.put("heading", location.hasBearing() ? location.getBearing() : JSObject.NULL);
        data.put("altitude", location.hasAltitude() ? location.getAltitude() : JSObject.NULL);
        data.put("timestamp", location.getTime());
        notifyListeners(LOCATION_UPDATE_EVENT, data);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", isServiceRunning());
        ret.put("permissions", buildPermissionStatus());
        call.resolve(ret);
    }

    /**
     * Demande les permissions dans l'ordre imposé par Android :
     *  - Android 11+ : fine/coarse d'abord, puis background (sinon auto-refusée).
     *  - Android 10 : les deux peuvent être demandées ensemble (dialogue "tout le temps").
     *  - Android 9 et inférieur : pas de permission background runtime.
     */
    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            if (!hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
                requestPermissionForAliases(buildInitialRequest(), call, CALLBACK_LOCATION);
            } else if (!hasAndroidPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                requestPermissionForAliases(buildBackgroundRequest(), call, CALLBACK_BACKGROUND);
            } else {
                resolvePermissionStatus(call);
            }
        } else if (Build.VERSION.SDK_INT == Build.VERSION_CODES.Q) {
            if (!hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                || !hasAndroidPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
                List<String> perms = new ArrayList<>();
                perms.add("location");
                perms.add("backgroundLocation");
                if (needsNotificationsPermission()) {
                    perms.add("notifications");
                }
                requestPermissionForAliases(perms.toArray(new String[0]), call, CALLBACK_LOCATION);
            } else {
                resolvePermissionStatus(call);
            }
        } else {
            if (!hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION)) {
                requestPermissionForAliases(buildInitialRequest(), call, CALLBACK_LOCATION);
            } else {
                resolvePermissionStatus(call);
            }
        }
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            && hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION)
            && !hasAndroidPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) {
            requestPermissionForAliases(buildBackgroundRequest(), call, CALLBACK_BACKGROUND);
            return;
        }
        resolvePermissionStatus(call);
    }

    @PermissionCallback
    private void backgroundPermissionCallback(PluginCall call) {
        resolvePermissionStatus(call);
    }

    private String[] buildInitialRequest() {
        List<String> perms = new ArrayList<>();
        perms.add("location");
        if (needsNotificationsPermission()) {
            perms.add("notifications");
        }
        return perms.toArray(new String[0]);
    }

    private String[] buildBackgroundRequest() {
        List<String> perms = new ArrayList<>();
        perms.add("backgroundLocation");
        if (needsNotificationsPermission()) {
            perms.add("notifications");
        }
        return perms.toArray(new String[0]);
    }

    private boolean needsNotificationsPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && !hasAndroidPermission(Manifest.permission.POST_NOTIFICATIONS);
    }

    private void resolvePermissionStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("permissions", buildPermissionStatus());
        call.resolve(ret);
    }

    private JSObject buildPermissionStatus() {
        JSObject perms = new JSObject();
        perms.put("fineGranted", hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION));
        perms.put("coarseGranted", hasAndroidPermission(Manifest.permission.ACCESS_COARSE_LOCATION));
        perms.put(
            "backgroundGranted",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                ? hasAndroidPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                : true
        );
        perms.put(
            "notificationsGranted",
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? hasAndroidPermission(Manifest.permission.POST_NOTIFICATIONS)
                : true
        );
        perms.put(
            "allGranted",
            hasAndroidPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                && (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                    || hasAndroidPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        );
        // État persistant de l'exemption d'optimisation batterie : exposé à chaque
        // getStatus()/start()/stop() pour que le JS puisse afficher une bannière tant
        // que batteryOptimizationIgnored === false (pas juste au démarrage du tracking).
        perms.put("batteryOptimizationIgnored", isBatteryOptimizationIgnored());
        return perms;
    }

    private boolean hasAndroidPermission(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
            == PackageManager.PERMISSION_GRANTED;
    }

    /** true si l'app est exemptée de l'optimisation batterie Android (Doze / standby). */
    private boolean isBatteryOptimizationIgnored() {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        if (pm == null) {
            return false;
        }
        return pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    /**
     * État courant de l'exemption d'optimisation batterie (batteryOptimizationIgnored).
     * Sert à l'UI pour afficher une bannière persistante tant que l'exemption n'est pas
     * accordée (et à la rafraîchir quand le chauffeur revient de Paramètres > Batterie).
     */
    @PluginMethod
    public void getBatteryOptimizationStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("batteryOptimizationIgnored", isBatteryOptimizationIgnored());
        call.resolve(ret);
    }

    /**
     * Détection de la marque du téléphone (surcouches agressives : MIUI, EMUI,
     * ColorOS, Vivo…) pour afficher au chauffeur les instructions de réglages
     * manuels spécifiques (démarrage automatique, verrouillage en arrière-plan).
     * Sans ces réglages, l'app est tuée en arrière-plan MÊME avec l'exemption
     * Android accordée.
     */
    @PluginMethod
    public void getDeviceInfo(PluginCall call) {
        JSObject ret = DeviceOemInfo.detect();
        ret.put("batteryOptimizationIgnored", isBatteryOptimizationIgnored());
        call.resolve(ret);
    }

    /**
     * Ouvre l'écran système le plus pertinent pour la marque : écran
     * d'autostart/gestion en arrière-plan si la marque en a un (MIUI, EMUI,
     * ColorOS, Vivo), sinon la page de détails de l'app (Batterie → Sans
     * restriction). Retourne { opened } pour que l'UI puisse afficher le bon
     * libellé.
     */
    @PluginMethod
    public void openOemBatterySettings(PluginCall call) {
        String opened = DeviceOemInfo.openBestSettings(getContext());
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }

    /**
     * Met à jour le texte de statut de la notification persistante du foreground
     * service (état RÉEL du suivi côté JS : actif / hors ligne avec file locale /
     * en pause). Le chauffeur voit ainsi l'état du tracking sans ouvrir l'app.
     */
    @PluginMethod
    public void updateTrackingStatus(PluginCall call) {
        String status = call.getString("status");
        if (status == null || status.trim().isEmpty()) {
            call.resolve();
            return;
        }
        LocationForegroundService.updateNotificationStatus(status.trim());
        call.resolve();
    }

    /**
     * Demande l'exemption d'optimisation batterie.
     * Si déjà exempté, résout immédiatement avec batteryOptimizationIgnored=true. Sinon ouvre
     * un écran système ; l'état réel n'est connu qu'au retour → on le relit dans le callback.
     *
     * STRATÉGIE PAR MARQUE :
     *  - Android quasi stock / Samsung : l'écran dédié ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
     *    (dialogue "Autoriser l'application à ignorer l'optimisation de la batterie ?") est le
     *    plus simple pour l'utilisateur — il exige la permission REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
     *    (déclarée dans le manifest) et est désormais privilégié ici.
     *  - Surcouches agressives (MIUI/HyperOS, EMUI, ColorOS, Vivo, OnePlus…) : cet écran « dédié »
     *    n'existe pas ou ne permet pas d'accorder réellement l'exemption (l'utilisateur revient
     *    sans changement → la bannière reste → il reclique → impression de boucle). On ouvre la
     *    page de détails de l'app (Paramètres → Applications → LogiTrack → Batterie → Sans
     *    restriction), présente sur TOUTES les surcouches et contenant le réglage réel.
     */
    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        if (isBatteryOptimizationIgnored()) {
            JSObject ret = new JSObject();
            ret.put("batteryOptimizationIgnored", true);
            ret.put("requested", false);
            call.resolve(ret);
            return;
        }
        Activity activity = getActivity();
        boolean aggressiveOem = DeviceOemInfo.isAggressive(
            detectOemKey()
        );
        Intent intent;
        if (!aggressiveOem) {
            // 1) Android quasi stock : dialogue dédié (meilleure UX, permission manifest ajoutée).
            intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getContext().getPackageName())
            );
            // Repli : si l'écran dédié est absent (rare), page de détails de l'app.
            if (activity == null || intent.resolveActivity(activity.getPackageManager()) == null) {
                intent = new Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getContext().getPackageName())
                );
            }
        } else {
            // 2) Surcouche agressive : page de détails de l'app (Batterie → Sans restriction).
            intent = new Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName())
            );
        }
        try {
            if (activity != null) {
                startActivityForResult(call, intent, CALLBACK_BATTERY_EXEMPTION);
            } else {
                // Aucune activité hôte : on ouvre quand même l'écran (avec NEW_TASK) pour
                // que le clic ne soit jamais silencieux, puis on résout avec l'état courant.
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject ret = new JSObject();
                ret.put("batteryOptimizationIgnored", isBatteryOptimizationIgnored());
                ret.put("requested", true);
                call.resolve(ret);
            }
        } catch (Exception ex) {
            call.reject("INTENT_FAILED", "intent_failed", ex);
        }
    }

    /** Clé OEM normalisée pour les décisions de stratégie batterie. */
    private String detectOemKey() {
        String manufacturer = Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase() : "";
        String brand = Build.BRAND != null ? Build.BRAND.toLowerCase() : "";
        String m = manufacturer + " " + brand;
        if (m.contains("xiaomi") || m.contains("redmi") || m.contains("poco")) return DeviceOemInfo.OEM_XIAOMI;
        if (m.contains("huawei") || m.contains("honor")) return DeviceOemInfo.OEM_HUAWEI;
        if (m.contains("oppo") || m.contains("realme") || m.contains("oneplus")) return DeviceOemInfo.OEM_OPPO;
        if (m.contains("vivo") || m.contains("iqoo")) return DeviceOemInfo.OEM_VIVO;
        return DeviceOemInfo.OEM_UNKNOWN;
    }

    @ActivityCallback
    private void batteryOptimizationExemptionCallback(PluginCall call, ActivityResult result) {
        // Capacitor 8 appelle les callbacks d'activité avec DEUX arguments :
        // (PluginCall, ActivityResult). Une signature à un seul argument provoquait
        // "IllegalArgumentException: Wrong number of arguments; expected 1, got 2"
        // → RuntimeException sur le main thread → l'app se fermait (crash systématique).
        JSObject ret = new JSObject();
        ret.put("batteryOptimizationIgnored", isBatteryOptimizationIgnored());
        ret.put("requested", true);
        if (result != null) {
            ret.put("resultCode", result.getResultCode());
        }
        call.resolve(ret);
    }

    @SuppressWarnings("deprecation")
    private boolean isServiceRunning() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        if (am == null) {
            return false;
        }
        for (ActivityManager.RunningServiceInfo info : am.getRunningServices(Integer.MAX_VALUE)) {
            if (LocationForegroundService.class.getName().equals(info.service.getClassName())) {
                return true;
            }
        }
        return false;
    }
}
