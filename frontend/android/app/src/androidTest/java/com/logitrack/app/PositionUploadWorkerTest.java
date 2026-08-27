package com.logitrack.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.work.ListenableWorker;
import androidx.work.testing.TestWorkerBuilder;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Tests instrumentés de PositionUploadWorker (Phase 4 — worker natif d'envoi,
 * indépendant du JS). Utilise le harnais officiel WorkManager (TestWorkerBuilder,
 * androidx.work:work-testing) pour exécuter doWork() directement.
 *
 * Nécessite un appareil/émulateur (vrai réseau localhost, vraie DB SQLite) :
 *   cd frontend/android && ./gradlew connectedAndroidTest --tests "*.PositionUploadWorkerTest"
 */
@RunWith(AndroidJUnit4.class)
public class PositionUploadWorkerTest {

    private Context context;
    private LocationQueueDb db;
    private Executor executor;
    private TinyTestHttpServer server;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        db = LocationQueueDb.getInstance(context);
        db.getWritableDatabase().delete(LocationQueueDb.TABLE, null, null);
        NativeAuthTokenStore.clear(context);
        executor = Executors.newSingleThreadExecutor();
    }

    @After
    public void tearDown() {
        if (server != null) {
            server.stop();
            server = null;
        }
        db.getWritableDatabase().delete(LocationQueueDb.TABLE, null, null);
        NativeAuthTokenStore.clear(context);
    }

    private void insertUnsyncedPositions(int count) {
        long baseTs = System.currentTimeMillis() - (long) count * 3000L;
        for (int i = 0; i < count; i++) {
            db.insert(
                "vehicle-native-test", null,
                -18.8792 + i * 0.0001, 47.5079,
                15f, 5f, 90f,
                baseTs + i * 3000L
            );
        }
    }

    private void configureValidToken() {
        NativeAuthTokenStore.setAuthToken(
            context, "eyFAKE.TEST.TOKEN", System.currentTimeMillis() + 900_000L
        );
    }

    private ListenableWorker.Result runWorkerOnce() {
        PositionUploadWorker worker = TestWorkerBuilder.from(
            context, PositionUploadWorker.class, executor
        ).build();
        return worker.doWork();
    }

    @Test
    public void serverReturns200_allThirtyPositionsMarkedSynced() throws Exception {
        server = new TinyTestHttpServer(200);
        NativeHttpFallback.storeApiUrl(context, "http://127.0.0.1:" + server.getPort());
        configureValidToken();
        insertUnsyncedPositions(30);
        assertEquals(30, db.countUnsynced());

        ListenableWorker.Result result = runWorkerOnce();

        assertTrue("Result doit être Success sur 200 OK", result instanceof ListenableWorker.Result.Success);
        assertEquals(
            "Les 30 positions doivent être marquées synced après un 200 OK",
            0, db.countUnsynced()
        );
        assertEquals(1, server.getRequestCount());
    }

    /**
     * RÉGRESSION (audit 2026-08-27, HAUTE) : le worker périodique (15 min) et le
     * worker one-shot (throttlé 15 s) vivent dans deux espaces de noms
     * WorkManager différents — ExistingWorkPolicy.KEEP protège chacun contre sa
     * propre duplication, mais RIEN n'empêchait auparavant les DEUX de tourner
     * en même temps et de poster deux fois le même lot. Simule cette course :
     * deux instances de PositionUploadWorker appellent doWork() au même instant
     * (CountDownLatch), sur la MÊME file. Un seul doit réellement contacter le
     * serveur — l'autre doit rendre la main immédiatement (Success, sans effet)
     * grâce au verrou statique `uploadInProgress`.
     */
    @Test
    public void concurrentPeriodicAndOneShot_onlyOneActuallyUploads_noDuplicateSend() throws Exception {
        server = new TinyTestHttpServer(200);
        NativeHttpFallback.storeApiUrl(context, "http://127.0.0.1:" + server.getPort());
        configureValidToken();
        insertUnsyncedPositions(30);
        assertEquals(30, db.countUnsynced());

        PositionUploadWorker workerA = TestWorkerBuilder.from(
            context, PositionUploadWorker.class, Executors.newSingleThreadExecutor()
        ).build();
        PositionUploadWorker workerB = TestWorkerBuilder.from(
            context, PositionUploadWorker.class, Executors.newSingleThreadExecutor()
        ).build();

        CountDownLatch startGate = new CountDownLatch(1);
        AtomicReference<ListenableWorker.Result> resultA = new AtomicReference<>();
        AtomicReference<ListenableWorker.Result> resultB = new AtomicReference<>();

        Thread threadA = new Thread(() -> {
            try {
                startGate.await();
            } catch (InterruptedException ignored) {}
            resultA.set(workerA.doWork());
        });
        Thread threadB = new Thread(() -> {
            try {
                startGate.await();
            } catch (InterruptedException ignored) {}
            resultB.set(workerB.doWork());
        });
        threadA.start();
        threadB.start();
        startGate.countDown(); // relâche les deux threads au même instant
        threadA.join(15_000);
        threadB.join(15_000);

        assertTrue("Les deux appels doivent réussir (le perdant rend juste la main sans rien envoyer)",
            resultA.get() instanceof ListenableWorker.Result.Success
                && resultB.get() instanceof ListenableWorker.Result.Success);
        assertEquals(
            "UN SEUL des deux doit avoir réellement contacté le serveur — sinon le lot part en double",
            1, server.getRequestCount()
        );
        assertEquals(
            "Les 30 positions doivent malgré tout être synchronisées (le gagnant vide toute la file)",
            0, db.countUnsynced()
        );
    }

    @Test
    public void serverReturns500_noPositionMarkedSynced_noDataLoss() throws Exception {
        server = new TinyTestHttpServer(500);
        NativeHttpFallback.storeApiUrl(context, "http://127.0.0.1:" + server.getPort());
        configureValidToken();
        insertUnsyncedPositions(30);
        assertEquals(30, db.countUnsynced());

        ListenableWorker.Result result = runWorkerOnce();

        assertTrue(
            "Result doit être Retry sur échec serveur — WorkManager doit retenter avec backoff",
            result instanceof ListenableWorker.Result.Retry
        );
        assertEquals(
            "AUCUNE position ne doit être marquée synced sur un échec serveur (pas de perte de données)",
            30, db.countUnsynced()
        );
    }

    @Test
    public void missingToken_workerDoesNotCrash_marksNothing() throws Exception {
        server = new TinyTestHttpServer(200);
        NativeHttpFallback.storeApiUrl(context, "http://127.0.0.1:" + server.getPort());
        // Pas de configureValidToken() : NativeAuthTokenStore.getAuthToken() renvoie null.
        insertUnsyncedPositions(10);

        ListenableWorker.Result result = runWorkerOnce();

        assertTrue(
            "Result doit être Success (pas de crash, cycle simplement ignoré)",
            result instanceof ListenableWorker.Result.Success
        );
        assertEquals(
            "Aucune position ne doit être marquée synced sans token valide",
            10, db.countUnsynced()
        );
        assertEquals(
            "Le serveur ne doit même pas avoir été contacté sans token",
            0, server.getRequestCount()
        );
    }

    @Test
    public void expiredToken_treatedSameAsMissing() throws Exception {
        server = new TinyTestHttpServer(200);
        NativeHttpFallback.storeApiUrl(context, "http://127.0.0.1:" + server.getPort());
        NativeAuthTokenStore.setAuthToken(context, "eyFAKE.EXPIRED", System.currentTimeMillis() - 1000L);
        insertUnsyncedPositions(5);

        ListenableWorker.Result result = runWorkerOnce();

        assertTrue(result instanceof ListenableWorker.Result.Success);
        assertEquals(5, db.countUnsynced());
        assertEquals(0, server.getRequestCount());
    }

    @Test
    public void noUnsyncedPositions_workerSucceedsWithoutContactingServer() throws Exception {
        server = new TinyTestHttpServer(200);
        NativeHttpFallback.storeApiUrl(context, "http://127.0.0.1:" + server.getPort());
        configureValidToken();
        // Aucune position insérée.

        ListenableWorker.Result result = runWorkerOnce();

        assertTrue(result instanceof ListenableWorker.Result.Success);
        assertEquals(0, server.getRequestCount());
    }
}
