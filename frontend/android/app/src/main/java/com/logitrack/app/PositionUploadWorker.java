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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Worker natif d'envoi des positions en file (LocationQueueDb, Phase 1) vers
 * POST /tracking/positions/native-batch (Phase 2), INDÉPENDANT du JS/WebView —
 * réutilise WorkManager (déjà en dépendance, déjà utilisé par
 * TrackingWatchdogWorker), aucune nouvelle lib de scheduling.
 *
 * DEUX DÉCLENCHEURS (voir BackgroundLocationPlugin.start()/stop() et
 * LocationForegroundService.handleLocationUpdate()) :
 *  - PÉRIODIQUE (15 min — plancher imposé par WorkManager pour tout travail
 *    périodique, contrainte NetworkType.CONNECTED) : filet de sécurité si le
 *    déclenchement one-shot a été manqué (ex. app tuée juste après une insertion).
 *  - ONE-SHOT ordinaire (JAMAIS "expedited" : voir
 *    triggerImmediateUploadIfNetworkAvailable — sur Android < 12 le mode
 *    expedited exige getForegroundInfoAsync(), absent de la classe Worker, ce
 *    qui faisait échouer chaque envoi immédiat), déclenché après une insertion
 *    en DB et throttlé à 1×/15 s. Un OneTimeWorkRequest n'a aucun plancher :
 *    il part dès que la contrainte réseau est satisfaite.
 *
 * Chaque exécution VIDE TOUTE la file (boucle bornée par MAX_BATCHES_PER_RUN),
 * pas seulement un lot : un arriéré de plusieurs milliers de positions
 * accumulé hors ligne se résorbe en un passage.
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
    /**
     * Nombre maximum de lots envoyés dans UNE exécution (vidage d'arriéré).
     * 25 × 200 = 5 000 positions par passage — largement de quoi rattraper une
     * nuit hors ligne, tout en restant loin de la limite d'exécution de
     * WorkManager (10 min). Le reliquat éventuel part au cycle suivant.
     */
    private static final int MAX_BATCHES_PER_RUN = 25;
    private static final AtomicLong lastTriggerAtMs = new AtomicLong(0);
    // Verrou anti-concurrence (audit 2026-08-27, HAUTE) : le worker PÉRIODIQUE
    // (15 min, nom unique PERIODIC_WORK_NAME) et le worker ONE-SHOT (nom unique
    // ONE_SHOT_WORK_NAME) vivent dans DEUX espaces de noms WorkManager
    // DIFFÉRENTS — ExistingWorkPolicy.KEEP protège chacun contre sa propre
    // duplication, mais RIEN n'empêche les deux de tourner EN MÊME TEMPS.
    // Sans ce verrou, les deux `doWork()` peuvent lire le même
    // getUnsyncedBatch() AVANT que l'un des deux ait appelé markSynced(), et
    // poster deux fois le même lot au serveur — la contrainte unique
    // (vehicleId, timestamp) en base ne protège que contre un REJEU du même
    // timestamp, pas contre deux INSERTIONS légitimes concurrentes du même lot
    // envoyé deux fois avec succès (deux requêtes HTTP distinctes, chacune
    // passant son propre contrôle avant que l'autre n'ait écrit). Non
    // bloquant : le worker qui perd la course rend la main immédiatement
    // (Result.success(), rien retenté ici — le PROCHAIN cycle s'en chargera),
    // jamais de deadlock.
    private static final AtomicBoolean uploadInProgress = new AtomicBoolean(false);

    public PositionUploadWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        if (!uploadInProgress.compareAndSet(false, true)) {
            Log.i(TAG, "Un envoi natif est déjà en cours (periodic/one-shot concurrents) — cycle ignoré, rien perdu");
            return Result.success();
        }
        try {
            return doWorkLocked();
        } finally {
            uploadInProgress.set(false);
        }
    }

    private Result doWorkLocked() {
        Context context = getApplicationContext();
        LocationQueueDb db = LocationQueueDb.getInstance(context);

        List<LocationQueueDb.QueuedPosition> batch = db.getUnsyncedBatch(BATCH_LIMIT);
        if (batch.isEmpty()) {
            db.pruneOld(); // entretien même sans rien à envoyer ce cycle
            return Result.success();
        }
        // Note : la boucle de vidage complet est plus bas (voir MAX_BATCHES_PER_RUN) —
        // ce premier lot sert aussi à valider token/URL avant d'engager la boucle.

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

        // VIDAGE COMPLET EN UN PASSAGE (audit 2026-08-27) : envoyer un seul lot de
        // BATCH_LIMIT par exécution ne suffisait pas à rattraper un arriéré — le
        // GPS capture en continu, donc un arriéré de plusieurs milliers de
        // positions (longue veille, tunnel, panne réseau) ne se serait JAMAIS
        // résorbé. On boucle jusqu'à vider la file, borné par
        // MAX_BATCHES_PER_RUN pour rester loin de la limite d'exécution de
        // WorkManager (10 min) : le reliquat éventuel part au cycle suivant
        // (quelques secondes plus tard), sans jamais rien perdre.
        int totalSynced = 0;
        try {
            for (int i = 0; i < MAX_BATCHES_PER_RUN; i++) {
                // WorkManager demande l'arrêt (contrainte perdue, annulation) :
                // on s'arrête proprement, ce qui est déjà envoyé reste marqué.
                if (isStopped()) break;

                int httpStatus = uploadBatch(apiUrl, token.token, batch);

                if (httpStatus == 401) {
                    // Credential refusé côté serveur (session révoquée, device
                    // token invalidé) : ne marque RIEN et n'insiste pas — le
                    // prochain passage du JS en poussera un nouveau.
                    Log.w(TAG, "Upload natif : 401 — credential refusé (" + totalSynced
                        + " position(s) déjà synchronisée(s) ce cycle), retry au prochain cycle");
                    return Result.success();
                }
                if (httpStatus < 200 || httpStatus >= 300) {
                    // Échec réseau/5xx : NE marque RIEN pour ce lot, laisse
                    // WorkManager retenter avec son backoff exponentiel natif.
                    // Les lots déjà confirmés plus haut restent acquis.
                    Log.w(TAG, "Upload natif échoué (HTTP " + httpStatus + ") — retry avec backoff");
                    return Result.retry();
                }

                List<Long> ids = new ArrayList<>(batch.size());
                for (LocationQueueDb.QueuedPosition p : batch) ids.add(p.id);
                db.markSynced(ids);
                totalSynced += ids.size();

                // Lot suivant : s'il est vide, la file est entièrement vidée.
                batch = db.getUnsyncedBatch(BATCH_LIMIT);
                if (batch.isEmpty()) break;
            }

            db.pruneOld();
            Log.i(TAG, "Upload natif réussi : " + totalSynced + " position(s) synchronisée(s)");
            return Result.success();
        } catch (IOException e) {
            Log.w(TAG, "Upload natif : erreur réseau — retry avec backoff", e);
            // Les lots confirmés avant la coupure sont déjà marqués : le retry
            // repartira du premier lot non encore synchronisé.
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
        // PAS de setExpedited() (audit 2026-08-27, cause racine confirmée sur
        // appareil réel Android 10 / API 29) : sur Android < 12, WorkManager
        // implémente le travail "expedited" en le lançant comme SERVICE DE
        // PREMIER PLAN, ce qui EXIGE que le worker fournisse une notification via
        // getForegroundInfoAsync(). La classe Worker de base ne l'implémente pas —
        // son implémentation par défaut LÈVE IllegalStateException. Résultat :
        // chaque envoi one-shot mourait instantanément (~40 ms) et WorkManager
        // marquait la tâche FAILED (constaté dans sa base interne :
        // `PositionUploadWorker FAILED tentatives=1`, alors que ce doWork() ne
        // retourne JAMAIS failure()). L'envoi immédiat n'a donc JAMAIS fonctionné
        // sur les appareils < Android 12 : seule la tâche périodique (15 min,
        // sans setExpedited) passait, plafonnée à BATCH_LIMIT — moins que ce que
        // le GPS capture dans le même intervalle, d'où une file qui ne pouvait
        // que croître indéfiniment ("hors ligne" permanent en veille).
        //
        // Un OneTimeWorkRequest ORDINAIRE n'a AUCUN plancher de 15 min (ce
        // plancher ne concerne que PeriodicWorkRequest) : il s'exécute dès que la
        // contrainte réseau est satisfaite, typiquement en quelques secondes.
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(PositionUploadWorker.class)
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
            .build();
        WorkManager.getInstance(context)
            .enqueueUniqueWork(ONE_SHOT_WORK_NAME, ExistingWorkPolicy.KEEP, request);
    }
}
