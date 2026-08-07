package com.logitrack.app;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;

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
        JSObject ret = new JSObject();
        ret.put("running", isServiceRunning());
        ret.put("permissions", buildPermissionStatus());
        call.resolve(ret);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        unsubscribeFromLocations();
        getContext().stopService(new Intent(getContext(), LocationForegroundService.class));
        JSObject ret = new JSObject();
        ret.put("running", false);
        ret.put("permissions", buildPermissionStatus());
        call.resolve(ret);
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
        return perms;
    }

    private boolean hasAndroidPermission(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
            == PackageManager.PERMISSION_GRANTED;
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
