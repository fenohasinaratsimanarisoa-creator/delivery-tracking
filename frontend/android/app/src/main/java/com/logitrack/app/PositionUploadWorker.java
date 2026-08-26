package com.logitrack.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.WorkRequest;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.TimeUnit;

/**
 * Worker natif d'envoi des positions en file (LocationQueueDb, Phase 1) vers
 * POST /tracking/positions/native-batch (Phase 2), INDÉPENDANT du JS/WebView —
 * réutilise WorkManager (déjà en dépendance, déjà utilisé par
 * TrackingWatchdogWorker), aucune nouvelle lib de scheduling.
 *
 * DEUX DÉCLENCHEURS (voir BackgroundLocationPlugin.start()/stop() et
 * LocationForegroundService.handleLocationUpdate()) :
 *  - PÉRIODIQUE (~3 min, contrainte NetworkType.CONNECTED) : filet de sécurité
 *    si le déclenchement one-shot a été manqué (ex. app tuée juste après une
 *    insertion).
 *  - ONE-SHOT EXPEDITED, immédiatement après CHAQUE insertion en DB : envoi
 *    au plus vite dès que le réseau est disponible. `enqueueUniqueWork` avec
 *    ExistingWorkPolicy.KEEP rend cet appel FRÉQUENT (à chaque position, ~3 s)
 *    sans coût : un travail déjà en attente/en cours n'est jamais dupliqué.
 *
 * ÉCHECS : ne marque JAMAIS une position comme synchronisée tant que le
 * serveur n'a pas répondu 2xx — aucune perte de données possible en cas
 * d'échec réseau/serveur (Result.retry() laisse WorkManager appliquer son
 * backoff exponentiel natif).
 */
public class PositionUploadWorker extends Worker {

    private static final String TAG = "PositionUploadWorker";
    public static final String PERIODIC_WORK_NAME = "logitrack_position_upload_periodic";
    public static final String ONE_SHOT_WORK_NAME = "logitrack_position_upload_oneshot";

    private static final int BATCH_LIMIT = 200;
    private static final long PERIODIC_INTERVAL_MINUTES = 3; // dans la fourchette demandée (2-5 min)

    public PositionUploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        LocationQueueDb db = LocationQueueDb.getInstance(context);

        List<LocationQueueDb.QueuedPosition> batch = db.getUnsyncedBatch(BATCH_LIMIT);
        if (batch.isEmpty()) {
            db.pruneOld(); // entretien même sans rien à envoyer ce cycle
            return Result.success();
        }

        // Token absent ou expiré : ne tente RIEN ce cycle, les lignes restent
        // non-synced (aucune perte) — log discret, retry au cycle suivant. Le
        // prochain refresh JS réussi (refreshToken.ts) mettra à jour le token
        // via setNativeAuthToken (Phase 3).
        NativeAuthTokenStore.StoredToken token = NativeAuthTokenStore.getAuthToken(context);
        if (token == null || token.isExpired()) {
            Log.i(TAG, "Aucun token natif valide — cycle ignoré (" + batch.size() + " position(s) en attente)");
            return Result.success();
        }

        String apiUrl = NativeHttpFallback.getApiUrl(context);
        if (apiUrl == null || apiUrl.isEmpty()) {
            Log.i(TAG, "URL API native non configurée — cycle ignoré");
            return Result.success();
        }

        try {
            int httpStatus = uploadBatch(apiUrl, token.token, batch);
            if (httpStatus >= 200 && httpStatus < 300) {
                List<Long> ids = new ArrayList<>(batch.size());
                for (LocationQueueDb.QueuedPosition p : batch) ids.add(p.id);
                db.markSynced(ids);
                db.pruneOld();
                Log.i(TAG, "Upload natif réussi : " + ids.size() + " position(s) synchronisée(s)");
                return Result.success();
            }
            if (httpStatus == 401) {
                // Token expiré côté serveur mais pas encore rafraîchi côté JS
                // (course possible entre les deux) : ne marque rien, retry au
                // prochain cycle — le prochain refresh JS mettra le token à jour.
                Log.w(TAG, "Upload natif : 401 (token pas encore rafraîchi côté JS) — retry au prochain cycle");
                return Result.success();
            }
            // Échec réseau/5xx (ou tout autre code inattendu) : NE marque RIEN,
            // laisse WorkManager retenter avec son backoff exponentiel natif.
            Log.w(TAG, "Upload natif échoué (HTTP " + httpStatus + ") — retry avec backoff");
            return Result.retry();
        } catch (IOException e) {
            Log.w(TAG, "Upload natif : erreur réseau — retry avec backoff", e);
            return Result.retry();
        }
    }

    /** POST HTTPS via HttpURLConnection (pas de nouvelle dépendance HTTP). Renvoie le code HTTP. */
    private int uploadBatch(String apiUrl, String token, List<LocationQueueDb.QueuedPosition> batch)
        throws IOException {
        String body;
        try {
            body = buildPayload(batch);
        } catch (JSONException e) {
            throw new IOException("Échec construction du payload JSON", e);
        }
        String endpoint = apiUrl.replaceAll("/+$", "") + "/tracking/positions/native-batch";

        HttpURLConnection conn = (HttpURLConnection) new URL(endpoint).openConnection();
        try {
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            // SÉCURITÉ : ne JAMAIS logger `token` — aucun Log.*(token) dans ce fichier.
            conn.setRequestProperty("Authorization", "Bearer " + token);
            conn.setDoOutput(true);
            conn.setConnectTimeout(15_000);
            conn.setReadTimeout(15_000);

            try (OutputStream os = conn.getOutputStream()) {
                os.write(body.getBytes(StandardCharsets.UTF_8));
            }

            return conn.getResponseCode();
        } finally {
            conn.disconnect();
        }
    }

    /** Format IDENTIQUE au chemin WebSocket JS (UpdatePositionDto) : { positions: [...] }. */
    private String buildPayload(List<LocationQueueDb.QueuedPosition> batch) throws JSONException {
        JSONArray positions = new JSONArray();
        for (LocationQueueDb.QueuedPosition p : batch) {
            JSONObject pos = new JSONObject();
            pos.put("latitude", p.lat);
            pos.put("longitude", p.lng);
            if (p.accuracy != null) pos.put("accuracy", p.accuracy);
            if (p.speed != null) pos.put("speed", p.speed);
            if (p.heading != null) pos.put("heading", p.heading);
            pos.put("timestamp", formatIsoTimestamp(p.timestampMs));
            pos.put("vehicleId", p.vehicleId);
            if (p.deliveryId != null && !p.deliveryId.isEmpty()) {
                pos.put("deliveryId", p.deliveryId);
            }
            positions.put(pos);
        }
        JSONObject payload = new JSONObject();
        payload.put("positions", positions);
        return payload.toString();
    }

    private static String formatIsoTimestamp(long millis) {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date(millis));
    }

    /**
     * Planifie l'exécution périodique (~3 min, contrainte réseau, backoff
     * exponentiel natif) — filet de sécurité en complément du déclenchement
     * one-shot. Appelé par BackgroundLocationPlugin.start().
     */
    public static void schedulePeriodic(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            PositionUploadWorker.class, PERIODIC_INTERVAL_MINUTES, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .build();
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    /** Appelé par BackgroundLocationPlugin.stop(). */
    public static void cancelPeriodic(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC_WORK_NAME);
    }

    /**
     * Déclenche un envoi EXPEDITED immédiatement après une insertion en DB.
     * Appelé à CHAQUE position (LocationForegroundService.handleLocationUpdate,
     * ~toutes les 3 s en tracking actif) : sans coût grâce à
     * ExistingWorkPolicy.KEEP — un travail déjà en attente/en cours pour ce nom
     * unique n'est JAMAIS dupliqué, WorkManager retourne immédiatement. La
     * contrainte NetworkType.CONNECTED fait que le travail attend nativement la
     * reprise réseau si nécessaire ("s'il y a du réseau" est géré par WorkManager
     * lui-même, pas par une vérification manuelle ici).
     */
    public static void triggerImmediateUploadIfNetworkAvailable(Context context) {
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(PositionUploadWorker.class)
            .setConstraints(constraints)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .build();
        WorkManager.getInstance(context)
            .enqueueUniqueWork(ONE_SHOT_WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }
}
