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

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

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
