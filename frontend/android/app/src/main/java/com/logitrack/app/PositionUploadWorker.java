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

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
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
    /**
     * Budget temps d'UNE exécution (audit GPS 2026-08-28, A10). WorkManager tue
     * un Worker au-delà de ~10 min. Or MAX_BATCHES_PER_RUN × (15 s de connect +
     * 15 s de read) = 12,5 min dans le pire cas : le cycle pouvait être tué en
     * plein envoi. Rien n'était perdu (seuls les lots confirmés sont marqués),
     * mais le rattrapage était plus lent qu'annoncé et l'arrêt était brutal. On
     * s'arrête proprement à 8 min : le reliquat part au cycle suivant.
     */
    private static final long MAX_RUN_DURATION_MS = 8 * 60 * 1000;
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
        int totalRejected = 0;
        try {
            final long runStartedAt = android.os.SystemClock.elapsedRealtime();
            for (int i = 0; i < MAX_BATCHES_PER_RUN; i++) {
                // WorkManager demande l'arrêt (contrainte perdue, annulation) :
                // on s'arrête proprement, ce qui est déjà envoyé reste marqué.
                if (isStopped()) break;
                if (android.os.SystemClock.elapsedRealtime() - runStartedAt > MAX_RUN_DURATION_MS) {
                    Log.i(TAG, "Budget temps du cycle atteint — reliquat envoyé au prochain cycle");
                    break;
                }

                UploadResult res = uploadBatch(apiUrl, token.token, batch);
                int httpStatus = res.httpStatus;

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

                // A1 (audit 2026-08-28) : ne marquer `synced` QUE ce que le
                // serveur a réellement traité. Les positions listées dans
                // `rejected` sont définitivement invalides — les retenter à
                // l'identique échouerait indéfiniment et bloquerait la file
                // entière (le lot le plus ancien repart toujours en premier).
                // On les retire donc AUSSI de la file, mais leur perte est
                // désormais COMPTÉE et JOURNALISÉE, jamais silencieuse.
                List<Long> acceptedIds = new ArrayList<>(batch.size());
                List<Long> rejectedIds = new ArrayList<>();
                for (int idx = 0; idx < batch.size(); idx++) {
                    if (res.rejectedIndexes.contains(idx)) {
                        rejectedIds.add(batch.get(idx).id);
                    } else {
                        acceptedIds.add(batch.get(idx).id);
                    }
                }

                if (!rejectedIds.isEmpty()) {
                    totalRejected += rejectedIds.size();
                    Log.w(
                        TAG,
                        "PERTE DE DONNÉES GPS : " + rejectedIds.size() + " position(s) refusée(s) "
                            + "définitivement par le serveur et retirée(s) de la file — motif(s): "
                            + res.rejectedReasons + ". Causes typiques : accuracy > 1000 m "
                            + "(fix trop imprécis), horloge de l'appareil décalée, position en "
                            + "file depuis plus de 30 jours."
                    );
                    db.markSynced(rejectedIds);
                }

                db.markSynced(acceptedIds);
                totalSynced += acceptedIds.size();
                // Canal de secours SMS (audit terrain 2026-08-27) : chaque upload HTTP
                // réussi repousse le seuil "hors ligne depuis" — voir SmsFallbackManager.
                SmsFallbackManager.markSyncSuccess(context);

                // Lot suivant : s'il est vide, la file est entièrement vidée.
                batch = db.getUnsyncedBatch(BATCH_LIMIT);
                if (batch.isEmpty()) break;
            }

            db.pruneOld();
            Log.i(
                TAG,
                "Upload natif réussi : " + totalSynced + " position(s) synchronisée(s)"
                    + (totalRejected > 0 ? ", " + totalRejected + " REFUSÉE(S) par le serveur" : "")
            );
            if (totalRejected > 0) {
                // Compteur cumulatif exposé au diagnostic (BackgroundLocationPlugin) :
                // une perte, même justifiée, doit rester visible dans l'app.
                recordRejected(context, totalRejected);
            }
            return Result.success();
        } catch (IOException e) {
            Log.w(TAG, "Upload natif : erreur réseau — retry avec backoff", e);
            // Les lots confirmés avant la coupure sont déjà marqués : le retry
            // repartira du premier lot non encore synchronisé.
            return Result.retry();
        }
    }

    /** Préférences de diagnostic : compteur cumulatif de positions refusées (A1). */
    private static final String PREFS_DIAG = "logitrack_tracking_diag";
    public static final String PREF_REJECTED_TOTAL = "gps_rejected_total";
    public static final String PREF_REJECTED_LAST_AT = "gps_rejected_last_at";

    /**
     * Comptabilise une perte définitive de positions. Une perte peut être
     * légitime (fix inexploitable), mais elle ne doit JAMAIS être invisible :
     * ce compteur est lisible par le JS via BackgroundLocationPlugin pour
     * alerter le chauffeur/dispatcher.
     */
    private static void recordRejected(Context context, int count) {
        try {
            android.content.SharedPreferences prefs =
                context.getSharedPreferences(PREFS_DIAG, Context.MODE_PRIVATE);
            prefs.edit()
                .putInt(PREF_REJECTED_TOTAL, prefs.getInt(PREF_REJECTED_TOTAL, 0) + count)
                .putLong(PREF_REJECTED_LAST_AT, System.currentTimeMillis())
                .apply();
        } catch (Exception e) {
            Log.w(TAG, "Impossible d'enregistrer le compteur de positions refusées", e);
        }
    }

    /** Résultat d'un envoi : code HTTP + index des positions DÉFINITIVEMENT rejetées. */
    static final class UploadResult {
        final int httpStatus;
        /** Index (dans le lot envoyé) rejetés par le serveur, avec leur motif. */
        final List<Integer> rejectedIndexes;
        final String rejectedReasons;

        UploadResult(int httpStatus, List<Integer> rejectedIndexes, String rejectedReasons) {
            this.httpStatus = httpStatus;
            this.rejectedIndexes = rejectedIndexes;
            this.rejectedReasons = rejectedReasons;
        }
    }

    /**
     * POST HTTPS via HttpURLConnection (pas de nouvelle dépendance HTTP).
     *
     * BUG CORRIGÉ (audit GPS 2026-08-28, A1 — CRITIQUE, perte de données) : cette
     * méthode ne renvoyait QUE le code HTTP, et le corps de la réponse n'était
     * JAMAIS lu. Le serveur, lui, pouvait jeter silencieusement des positions
     * invalides (accuracy > 1000 m, horloge décalée…) tout en répondant 200 :
     * l'appelant marquait alors TOUT le lot `synced` et les positions rejetées
     * étaient définitivement détruites. Pire cas reproductible : une horloge
     * d'appareil décalée de plus de 5 min invalidait TOUTES les positions →
     * la file entière était effacée lot par lot, sans une seule erreur visible.
     * On lit désormais `rejected[]` pour distinguer accepté / rejeté.
     */
    private UploadResult uploadBatch(
        String apiUrl, String token, List<LocationQueueDb.QueuedPosition> batch
    ) throws IOException {
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

            int status = conn.getResponseCode();
            List<Integer> rejectedIndexes = new ArrayList<>();
            StringBuilder reasons = new StringBuilder();
            if (status >= 200 && status < 300) {
                parseRejected(readBody(conn), rejectedIndexes, reasons);
            }
            return new UploadResult(status, rejectedIndexes, reasons.toString());
        } finally {
            conn.disconnect();
        }
    }

    private static String readBody(HttpURLConnection conn) {
        try (InputStream in = conn.getInputStream();
             BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            // Réponse toujours petite (compteurs + index rejetés) : borne large de sécurité.
            while ((line = r.readLine()) != null && sb.length() < 64_000) sb.append(line);
            return sb.toString();
        } catch (IOException e) {
            return "";
        }
    }

    /**
     * Extrait `rejected: [{index, reason}]` de la réponse. Tolérant : une réponse
     * d'un serveur plus ancien (sans ce champ) laisse simplement la liste vide —
     * le comportement retombe alors sur l'ancien (tout le lot marqué synced),
     * jamais une exception qui bloquerait l'envoi.
     */
    private static void parseRejected(String body, List<Integer> outIndexes, StringBuilder outReasons) {
        if (body == null || body.isEmpty()) return;
        try {
            JSONArray rejected = new JSONObject(body).optJSONArray("rejected");
            if (rejected == null) return;
            for (int i = 0; i < rejected.length(); i++) {
                JSONObject item = rejected.optJSONObject(i);
                if (item == null) continue;
                int index = item.optInt("index", -1);
                if (index < 0) continue;
                outIndexes.add(index);
                String reason = item.optString("reason", "invalid");
                if (outReasons.indexOf(reason) < 0) {
                    if (outReasons.length() > 0) outReasons.append(" | ");
                    outReasons.append(reason);
                }
            }
        } catch (JSONException ignored) {
            // Corps illisible : on ne prétend AUCUN rejet (aucune suppression indue).
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
        // BUG CORRIGÉ (audit GPS 2026-08-28, A9) : ce throttle utilisait
        // System.currentTimeMillis() (horloge MURALE). Un saut d'horloge vers le
        // futur — fréquent au premier NTP après un redémarrage, ou sur un
        // appareil dont l'heure est réglée à la main — figeait `lastTriggerAtMs`
        // dans le futur : `now - last` restait négatif, donc < 15 s, et PLUS
        // AUCUN envoi immédiat n'était déclenché jusqu'à ce que l'horloge
        // rattrape. SystemClock.elapsedRealtime() est monotone depuis le boot et
        // insensible à tout réglage d'heure.
        long now = android.os.SystemClock.elapsedRealtime();
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
