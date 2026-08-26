package com.logitrack.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.assertNull;

import android.content.Context;
import android.content.ContentValues;
import android.database.sqlite.SQLiteDatabase;
import android.location.Location;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.util.ArrayList;
import java.util.List;

/**
 * Tests instrumentés de LocationQueueDb (Phase 1 — persistance native
 * indépendante du JS/WebView) et de LocationForegroundService.handleLocationUpdate
 * (le point d'entrée réel utilisé en production).
 *
 * Nécessite un appareil/émulateur (SQLite réel, pas de simulation JVM) :
 *   cd frontend/android && ./gradlew connectedAndroidTest --tests "*.LocationQueueDbTest"
 */
@RunWith(AndroidJUnit4.class)
public class LocationQueueDbTest {

    private Context context;
    private LocationQueueDb db;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        db = LocationQueueDb.getInstance(context);
        // Isolation : chaque test repart d'une table vide. LocationQueueDb est un
        // singleton par process (recommandation Android) — on ne recrée pas la DB,
        // on vide juste son contenu.
        db.getWritableDatabase().delete(LocationQueueDb.TABLE, null, null);
    }

    @After
    public void tearDown() {
        db.getWritableDatabase().delete(LocationQueueDb.TABLE, null, null);
    }

    // -------------------------------------------------------------------
    // insert() / count()
    // -------------------------------------------------------------------

    @Test
    public void insert100Positions_countReflects100() {
        long baseTs = 1_700_000_000_000L;
        for (int i = 0; i < 100; i++) {
            long id = db.insert(
                "vehicle-1", "delivery-1",
                -18.8792 + i * 0.0001, 47.5079 + i * 0.0001,
                15f, 5f, 90f,
                baseTs + i * 3000L
            );
            assertTrue("insert() doit renvoyer un id >= 0 (pas -1 = échec)", id >= 0);
        }
        assertEquals(100, db.count());
        assertEquals(100, db.countUnsynced());
    }

    // -------------------------------------------------------------------
    // getUnsyncedBatch() — ordre chronologique croissant
    // -------------------------------------------------------------------

    @Test
    public void getUnsyncedBatch_returnsInAscendingTimestampOrder() {
        long baseTs = 1_700_000_000_000L;
        // Insertion volontairement DANS LE DÉSORDRE (simule un réordonnancement
        // improbable mais possible) — le tri doit venir de la requête, pas de
        // l'ordre d'insertion.
        long[] tsOffsetsInsertOrder = {5000, 1000, 3000, 0, 4000, 2000};
        for (long offset : tsOffsetsInsertOrder) {
            db.insert("vehicle-1", null, -18.9, 47.5, 15f, null, null, baseTs + offset);
        }

        List<LocationQueueDb.QueuedPosition> batch = db.getUnsyncedBatch(10);
        assertEquals(6, batch.size());
        for (int i = 1; i < batch.size(); i++) {
            assertTrue(
                "getUnsyncedBatch() doit être trié par timestamp_ms CROISSANT",
                batch.get(i).timestampMs >= batch.get(i - 1).timestampMs
            );
        }
        assertEquals(baseTs, batch.get(0).timestampMs);
        assertEquals(baseTs + 5000, batch.get(batch.size() - 1).timestampMs);
    }

    @Test
    public void getUnsyncedBatch_respectsLimit() {
        long baseTs = 1_700_000_000_000L;
        for (int i = 0; i < 20; i++) {
            db.insert("vehicle-1", null, -18.9, 47.5, 15f, null, null, baseTs + i * 1000L);
        }
        List<LocationQueueDb.QueuedPosition> batch = db.getUnsyncedBatch(5);
        assertEquals(5, batch.size());
        // Les 5 PLUS ANCIENNES (ordre croissant), pas 5 au hasard.
        for (int i = 0; i < 5; i++) {
            assertEquals(baseTs + i * 1000L, batch.get(i).timestampMs);
        }
    }

    // -------------------------------------------------------------------
    // markSynced() — exclusion des résultats non-synced
    // -------------------------------------------------------------------

    @Test
    public void markSynced_excludesRowsFromUnsyncedResults() {
        long baseTs = 1_700_000_000_000L;
        List<Long> ids = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            ids.add(db.insert("vehicle-1", null, -18.9, 47.5, 15f, null, null, baseTs + i * 1000L));
        }
        assertEquals(10, db.countUnsynced());

        // Marque les 4 premières (les plus anciennes) comme synchronisées.
        List<Long> firstFour = ids.subList(0, 4);
        db.markSynced(firstFour);

        assertEquals(6, db.countUnsynced());
        assertEquals(10, db.count()); // rien supprimé, juste marqué

        List<LocationQueueDb.QueuedPosition> remaining = db.getUnsyncedBatch(100);
        assertEquals(6, remaining.size());
        for (LocationQueueDb.QueuedPosition p : remaining) {
            assertTrue(
                "Une ligne marquée synced ne doit plus apparaître dans getUnsyncedBatch()",
                !firstFour.contains(p.id)
            );
        }
    }

    @Test
    public void markSynced_emptyList_isNoOp() {
        db.insert("vehicle-1", null, -18.9, 47.5, 15f, null, null, 1_700_000_000_000L);
        assertEquals(1, db.countUnsynced());
        db.markSynced(new ArrayList<>());
        assertEquals(1, db.countUnsynced());
    }

    // -------------------------------------------------------------------
    // pruneOld() — sur un jeu de données dépassant 50 000 lignes non-synced
    // -------------------------------------------------------------------

    @Test
    public void pruneOld_purgesOldestBeyond50000UnsyncedRows() {
        long baseTs = 1_700_000_000_000L;
        int total = 50_100; // dépasse le plafond MAX_UNSYNCED_ROWS de 100 lignes

        // Insertion en masse via une transaction UNIQUE (perf test — chaque insert()
        // individuel committerait sinon séparément, beaucoup trop lent pour 50k+
        // lignes). Utilise directement getWritableDatabase() + les constantes de
        // colonnes publiques de LocationQueueDb, sans dupliquer sa logique.
        SQLiteDatabase writable = db.getWritableDatabase();
        writable.beginTransaction();
        try {
            for (int i = 0; i < total; i++) {
                ContentValues values = new ContentValues();
                values.put(LocationQueueDb.COL_VEHICLE_ID, "vehicle-1");
                values.put(LocationQueueDb.COL_LAT, -18.9);
                values.put(LocationQueueDb.COL_LNG, 47.5);
                values.put(LocationQueueDb.COL_TIMESTAMP_MS, baseTs + i * 1000L);
                values.put(LocationQueueDb.COL_SYNCED, 0);
                values.put(LocationQueueDb.COL_CREATED_AT, System.currentTimeMillis());
                writable.insert(LocationQueueDb.TABLE, null, values);
            }
            writable.setTransactionSuccessful();
        } finally {
            writable.endTransaction();
        }
        assertEquals(total, db.countUnsynced());

        db.pruneOld();

        // Doit être ramené EXACTEMENT au plafond (50 000) — les 100 lignes en trop
        // (les plus ANCIENNES, timestamp_ms le plus faible) ont été supprimées.
        assertEquals(50_000, db.countUnsynced());

        // Vérifie que ce sont bien les plus anciennes qui ont disparu : la ligne la
        // plus ancienne restante doit être la 101ᵉ insérée (index 100), pas l'index 0.
        List<LocationQueueDb.QueuedPosition> remaining = db.getUnsyncedBatch(1);
        assertEquals(1, remaining.size());
        assertEquals(baseTs + 100 * 1000L, remaining.get(0).timestampMs);
    }

    @Test
    public void pruneOld_removesSyncedRowsOlderThan30Days() {
        long now = System.currentTimeMillis();
        long thirtyOneDaysAgo = now - (31L * 24 * 60 * 60 * 1000);
        long tenDaysAgo = now - (10L * 24 * 60 * 60 * 1000);

        SQLiteDatabase writable = db.getWritableDatabase();
        // Ligne synced ancienne (> 30 jours) — DOIT être purgée.
        ContentValues oldSynced = new ContentValues();
        oldSynced.put(LocationQueueDb.COL_VEHICLE_ID, "vehicle-1");
        oldSynced.put(LocationQueueDb.COL_LAT, -18.9);
        oldSynced.put(LocationQueueDb.COL_LNG, 47.5);
        oldSynced.put(LocationQueueDb.COL_TIMESTAMP_MS, thirtyOneDaysAgo);
        oldSynced.put(LocationQueueDb.COL_SYNCED, 1);
        oldSynced.put(LocationQueueDb.COL_CREATED_AT, thirtyOneDaysAgo);
        writable.insert(LocationQueueDb.TABLE, null, oldSynced);

        // Ligne synced récente (< 30 jours) — doit RESTER.
        ContentValues recentSynced = new ContentValues();
        recentSynced.put(LocationQueueDb.COL_VEHICLE_ID, "vehicle-1");
        recentSynced.put(LocationQueueDb.COL_LAT, -18.9);
        recentSynced.put(LocationQueueDb.COL_LNG, 47.5);
        recentSynced.put(LocationQueueDb.COL_TIMESTAMP_MS, tenDaysAgo);
        recentSynced.put(LocationQueueDb.COL_SYNCED, 1);
        recentSynced.put(LocationQueueDb.COL_CREATED_AT, tenDaysAgo);
        writable.insert(LocationQueueDb.TABLE, null, recentSynced);

        assertEquals(2, db.count());

        db.pruneOld();

        assertEquals(
            "Seule la ligne synced de plus de 30 jours doit être purgée",
            1, db.count()
        );
    }

    // -------------------------------------------------------------------
    // handleLocationUpdate() appelé SANS aucun listener JS attaché — le
    // point d'entrée RÉEL utilisé par LocationForegroundService en production.
    // -------------------------------------------------------------------

    @Test
    public void handleLocationUpdate_persistsEvenWithoutAnyJsListenerAttached() throws InterruptedException {
        // Aucun sink JS enregistré : simule une WebView jamais initialisée / gelée
        // (aucun appel à LocationForegroundService.addLocationSink()).
        LocationForegroundService.setNativeContext("vehicle-native-test", "delivery-native-test");

        long baseTs = 1_700_000_000_000L;
        for (int i = 0; i < 20; i++) {
            Location loc = new Location("test");
            loc.setLatitude(-18.8792 + i * 0.0001);
            loc.setLongitude(47.5079 + i * 0.0001);
            loc.setAccuracy(15f);
            loc.setTime(baseTs + i * 3000L);
            LocationForegroundService.handleLocationUpdate(context, loc);
        }

        // L'écriture est postée sur un executor asynchrone dédié (DB_WRITE_EXECUTOR,
        // privé à LocationForegroundService) — on attend son exécution en pollant
        // countUnsynced() plutôt que d'accéder à l'executor (non testable
        // directement, private à la classe).
        long deadline = System.currentTimeMillis() + 5000;
        while (db.countUnsynced() < 20 && System.currentTimeMillis() < deadline) {
            Thread.sleep(50);
        }

        assertEquals(
            "Les 20 positions doivent être en base malgré l'absence de tout listener JS",
            20, db.countUnsynced()
        );
    }

    @Test
    public void handleLocationUpdate_doesNothingWhenNativeVehicleIdNotSet() throws InterruptedException {
        // Contexte natif JAMAIS renseigné (setNativeContext non appelé, ou vidé) :
        // aucune écriture ne doit se produire — comportement attendu avant tout
        // démarrage réel de tracking.
        LocationForegroundService.setNativeContext("", "");

        Location loc = new Location("test");
        loc.setLatitude(-18.8792);
        loc.setLongitude(47.5079);
        loc.setTime(1_700_000_000_000L);
        LocationForegroundService.handleLocationUpdate(context, loc);

        Thread.sleep(300); // laisse une éventuelle écriture asynchrone se produire
        assertEquals(0, db.countUnsynced());
    }
}
