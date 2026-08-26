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
import java.util.concurrent.atomic.AtomicLong;

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
    // BUG CORRIGÉ (audit 2026-08-26, terrain réel) : WorkManager/JobScheduler
    // impose un PLANCHER ABSOLU de 15 min pour tout PeriodicWorkRequest
    // (PeriodicWorkRequest.MIN_PERIODIC_INTERVAL_MILLIS) — une valeur plus
    // courte n'est PAS refusée, elle est silencieusement CLAMPÉE à 15 min par
    // le framework. La valeur "3 min" ici était donc un mensonge inoffensif
    // pour ce filet de sécurité (déjà réellement à 15 min), mais a longtemps
    // masqué le vrai problème : le déclencheur one-shot ci-dessous (censé
    // fournir le rythme quasi temps-réel) tombait dans le même piège.
    private static final long PERIODIC_INTERVAL_MINUTES = 15;
    // Anti-épuisement du quota "expedited work" (voir
    // triggerImmediateUploadIfNetworkAvailable ci-dessous).
    private static final long MIN_TRIGGER_INTERVAL_MS = 15_000;
    private static final AtomicLong lastTriggerAtMs = new AtomicLong(0);

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
     * Déclenche un envoi EXPEDITED après une insertion en DB, au plus une fois
     * toutes les MIN_TRIGGER_INTERVAL_MS (throttle explicite en amont de
     * WorkManager — voir ci-dessous).
     *
     * BUG CORRIGÉ (audit 2026-08-26, diagnostiqué sur DB réelle : 117 positions
     * capturées, 0 jamais synchronisées) : ce trigger était appelé À CHAQUE
     * position (~toutes les 3 s en tracking actif). Le commentaire d'origine
     * ("sans coût grâce à ExistingWorkPolicy.KEEP") était trompeur : KEEP évite
     * bien la duplication tant qu'un travail est DÉJÀ en attente/en cours, mais
     * dès qu'un envoi réussissait (quelques secondes), le nom unique se
     * libérait — et la position suivante (3 s plus tard) redemandait
     * IMMÉDIATEMENT un nouveau travail EXPEDITED. Répété en continu, ce rythme
     * épuise en quelques minutes le quota "expedited work" qu'Android accorde
     * à une app en arrière-plan (même exemptée d'optimisation batterie,
     * vérifié sur l'appareil de test). Une fois épuisé,
     * RUN_AS_NON_EXPEDITED_WORK_REQUEST rétrograde chaque tentative en travail
     * différé ordinaire — soumis au PLANCHER de 15 min de WorkManager (voir
     * PERIODIC_INTERVAL_MINUTES) : confirmé sur l'appareil (dumpsys
     * jobscheduler) par DEUX jobs bloqués à "Minimum latency: +14m59s". Résultat
     * : dès que le quota était épuisé, plus AUCUN envoi avant ~15 min — perçu
     * comme "l'app ne partage plus jamais et ne se reconnecte plus".
     *
     * Le throttle ci-dessous limite les DEMANDES de travail expedited à au
     * plus une toutes les 15 s (early-return synchrone, sans toucher
     * WorkManager si appelé trop tôt) — largement suffisant pour rester dans
     * le quota, sans perte : chaque déclenchement envoie TOUT le lot en
     * attente (jusqu'à BATCH_LIMIT), pas seulement la dernière position. Le
     * pire cas passe d'un blocage de ~15 min à un simple délai de ~15 s.
     */
    public static void triggerImmediateUploadIfNetworkAvailable(Context context) {
        long now = System.currentTimeMillis();
        long last = lastTriggerAtMs.get();
        if (now - last < MIN_TRIGGER_INTERVAL_MS) {
            return; // Trop tôt : le prochain appel (position suivante) ou le
                     // filet périodique s'en chargera — aucune position n'est
                     // perdue, elle reste simplement en file un peu plus longtemps.
        }
        if (!lastTriggerAtMs.compareAndSet(last, now)) {
            return; // Un autre thread vient de déclencher entre-temps.
        }
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
