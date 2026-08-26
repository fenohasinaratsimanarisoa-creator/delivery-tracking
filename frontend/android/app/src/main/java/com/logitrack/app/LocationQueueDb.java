package com.logitrack.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Log;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * File de positions GPS persistée en SQLite, INDÉPENDANTE du JS/WebView.
 *
 * POURQUOI : le pipeline existant (LocationForegroundService → notifyListeners →
 * useDriverTracking.ts → IndexedDB → socket) dépend entièrement d'un JS vivant. Si
 * la WebView est suspendue/tuée par l'OS (Doze agressif de certains OEM, ou de
 * longues heures sans premier plan), les positions acquises nativement pendant
 * cette fenêtre ne sont JAMAIS écrites nulle part — elles n'existent qu'en RAM
 * le temps de l'appel notifyListeners. Cette classe donne un filet de sécurité
 * au niveau NATIF : chaque position est écrite ici de façon SYNCHRONE, sur un
 * thread dédié, AVANT même que le JS ne soit sollicité (voir
 * LocationForegroundService.onLocationResult). Le JS/IndexedDB reste le chemin
 * "temps réel" pour l'UI ; cette base devient le filet de sécurité qui survit à
 * un JS mort.
 *
 * PAS de Room, PAS de nouvelle dépendance Gradle : SQLiteOpenHelper brut (déjà
 * dans le SDK Android), cohérent avec NativeHttpFallback (déjà zéro dépendance
 * externe dans ce module).
 */
public class LocationQueueDb extends SQLiteOpenHelper {

    private static final String TAG = "LocationQueueDb";
    private static final String DB_NAME = "logitrack_location_queue.db";
    private static final int DB_VERSION = 1;

    public static final String TABLE = "position_queue";
    public static final String COL_ID = "id";
    public static final String COL_VEHICLE_ID = "vehicle_id";
    public static final String COL_DELIVERY_ID = "delivery_id";
    public static final String COL_LAT = "lat";
    public static final String COL_LNG = "lng";
    public static final String COL_ACCURACY = "accuracy";
    public static final String COL_SPEED = "speed";
    public static final String COL_HEADING = "heading";
    public static final String COL_TIMESTAMP_MS = "timestamp_ms";
    public static final String COL_SYNCED = "synced";
    public static final String COL_CREATED_AT = "created_at";

    /** Purge des lignes synced=1 plus vieilles que 30 jours (voir pruneOld()). */
    private static final long SYNCED_RETENTION_MS = TimeUnit.DAYS.toMillis(30);
    /**
     * Plafond de lignes NON synchronisées : au-delà, les plus anciennes sont
     * purgées (dernier recours anti-saturation disque). 50 000 lignes ≈ plusieurs
     * jours d'acquisition continue à 3 s/fix — un vrai dépassement ne peut arriver
     * que si le worker d'envoi (Phase 4) est lui-même en panne prolongée (token
     * absent, backend injoignable) : mieux vaut perdre les positions les PLUS
     * ANCIENNES (déjà obsolètes pour le dispatcher temps réel) que de saturer le
     * disque de l'appareil et faire planter l'app entière.
     */
    private static final int MAX_UNSYNCED_ROWS = 50_000;

    private static volatile LocationQueueDb instance;

    /** Instance singleton — un seul SQLiteOpenHelper par process (recommandation Android). */
    public static synchronized LocationQueueDb getInstance(Context context) {
        if (instance == null) {
            instance = new LocationQueueDb(context.getApplicationContext());
        }
        return instance;
    }

    private LocationQueueDb(Context context) {
        super(context, DB_NAME, null, DB_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE " + TABLE + " ("
                + COL_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, "
                + COL_VEHICLE_ID + " TEXT, "
                + COL_DELIVERY_ID + " TEXT, "
                + COL_LAT + " REAL, "
                + COL_LNG + " REAL, "
                + COL_ACCURACY + " REAL, "
                + COL_SPEED + " REAL, "
                + COL_HEADING + " REAL, "
                + COL_TIMESTAMP_MS + " INTEGER, "
                + COL_SYNCED + " INTEGER DEFAULT 0, "
                + COL_CREATED_AT + " INTEGER"
                + ")"
        );
        // Index composites : getUnsyncedBatch (synced, timestamp_ms) et pruneOld
        // (synced, timestamp_ms/created_at) sont les deux requêtes chaudes de cette
        // table — sans index, un plein-scan sur 50k lignes à chaque cycle du worker
        // (Phase 4, toutes les 2-5 min) coûterait cher sur un appareil bas de gamme.
        db.execSQL(
            "CREATE INDEX idx_position_queue_synced_ts ON " + TABLE
                + " (" + COL_SYNCED + ", " + COL_TIMESTAMP_MS + ")"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Pas de migration nécessaire pour l'instant (DB_VERSION = 1 depuis la
        // création) — repli défensif si une future version doit un jour migrer :
        // ne JAMAIS perdre silencieusement des positions non synchronisées.
        Log.w(TAG, "onUpgrade appelé (" + oldVersion + " -> " + newVersion + ") — aucune migration définie");
    }

    /**
     * Insertion SYNCHRONE d'une position. DOIT être appelée depuis un thread dédié
     * (jamais le main thread ni le thread de callback location) — voir
     * LocationForegroundService.onLocationResult, qui poste cet appel sur un
     * Executor mono-thread dédié aux écritures DB.
     */
    public long insert(
        String vehicleId,
        String deliveryId,
        double lat,
        double lng,
        Float accuracy,
        Float speed,
        Float heading,
        long timestampMs
    ) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put(COL_VEHICLE_ID, vehicleId);
        values.put(COL_DELIVERY_ID, deliveryId);
        values.put(COL_LAT, lat);
        values.put(COL_LNG, lng);
        if (accuracy != null) values.put(COL_ACCURACY, accuracy); else values.putNull(COL_ACCURACY);
        if (speed != null) values.put(COL_SPEED, speed); else values.putNull(COL_SPEED);
        if (heading != null) values.put(COL_HEADING, heading); else values.putNull(COL_HEADING);
        values.put(COL_TIMESTAMP_MS, timestampMs);
        values.put(COL_SYNCED, 0);
        values.put(COL_CREATED_AT, System.currentTimeMillis());
        long id = db.insert(TABLE, null, values);
        if (id == -1) {
            Log.e(TAG, "Echec insertion position (vehicleId=" + vehicleId + ", ts=" + timestampMs + ")");
        }
        return id;
    }

    /** Nombre total de lignes (toutes confondues, synced ou non) — utilitaire de test. */
    public long count() {
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM " + TABLE, null)) {
            return c.moveToFirst() ? c.getLong(0) : 0;
        }
    }

    public long countUnsynced() {
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.rawQuery(
            "SELECT COUNT(*) FROM " + TABLE + " WHERE " + COL_SYNCED + " = 0", null)) {
            return c.moveToFirst() ? c.getLong(0) : 0;
        }
    }

    /** Représentation immuable d'une ligne en file, pour le worker d'envoi (Phase 4). */
    public static final class QueuedPosition {
        public final long id;
        public final String vehicleId;
        public final String deliveryId;
        public final double lat;
        public final double lng;
        public final Float accuracy;
        public final Float speed;
        public final Float heading;
        public final long timestampMs;

        QueuedPosition(long id, String vehicleId, String deliveryId, double lat, double lng,
                        Float accuracy, Float speed, Float heading, long timestampMs) {
            this.id = id;
            this.vehicleId = vehicleId;
            this.deliveryId = deliveryId;
            this.lat = lat;
            this.lng = lng;
            this.accuracy = accuracy;
            this.speed = speed;
            this.heading = heading;
            this.timestampMs = timestampMs;
        }
    }

    /**
     * Jusqu'à `limit` lignes NON synchronisées, triées par timestamp_ms CROISSANT
     * (ordre chronologique d'acquisition — le backend/rapport carburant attend un
     * flux chronologique, cf. saveBatch côté serveur qui re-trie de toute façon
     * mais autant envoyer déjà dans l'ordre).
     */
    public List<QueuedPosition> getUnsyncedBatch(int limit) {
        List<QueuedPosition> result = new ArrayList<>();
        SQLiteDatabase db = getReadableDatabase();
        try (Cursor c = db.query(
            TABLE,
            new String[]{COL_ID, COL_VEHICLE_ID, COL_DELIVERY_ID, COL_LAT, COL_LNG,
                COL_ACCURACY, COL_SPEED, COL_HEADING, COL_TIMESTAMP_MS},
            COL_SYNCED + " = 0",
            null,
            null,
            null,
            COL_TIMESTAMP_MS + " ASC",
            String.valueOf(Math.max(0, limit))
        )) {
            while (c.moveToNext()) {
                result.add(new QueuedPosition(
                    c.getLong(0),
                    c.getString(1),
                    c.isNull(2) ? null : c.getString(2),
                    c.getDouble(3),
                    c.getDouble(4),
                    c.isNull(5) ? null : c.getFloat(5),
                    c.isNull(6) ? null : c.getFloat(6),
                    c.isNull(7) ? null : c.getFloat(7),
                    c.getLong(8)
                ));
            }
        }
        return result;
    }

    /** Marque les lignes données comme synchronisées (synced=1). No-op sur liste vide. */
    public void markSynced(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return;
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            ContentValues values = new ContentValues();
            values.put(COL_SYNCED, 1);
            for (Long id : ids) {
                db.update(TABLE, values, COL_ID + " = ?", new String[]{String.valueOf(id)});
            }
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    /**
     * Purge d'entretien, à appeler périodiquement (ex. depuis le worker d'envoi,
     * Phase 4, après chaque cycle réussi) :
     *  1. Supprime les lignes synced=1 de plus de 30 jours (elles ont déjà été
     *     envoyées au backend, aucune valeur à les garder indéfiniment).
     *  2. Si la table dépasse MAX_UNSYNCED_ROWS lignes NON synchronisées, purge
     *     les plus anciennes non-synced au-delà de ce plafond — dernier recours
     *     anti-saturation disque. JAMAIS silencieux : log un warning explicite à
     *     chaque purge forcée, pour que ce cas anormal (le worker d'envoi est en
     *     panne depuis longtemps) soit visible en diagnostic.
     */
    public void pruneOld() {
        SQLiteDatabase db = getWritableDatabase();
        long cutoff = System.currentTimeMillis() - SYNCED_RETENTION_MS;
        int deletedOld = db.delete(
            TABLE,
            COL_SYNCED + " = 1 AND " + COL_CREATED_AT + " < ?",
            new String[]{String.valueOf(cutoff)}
        );
        if (deletedOld > 0) {
            Log.i(TAG, "pruneOld: " + deletedOld + " ligne(s) synced supprimée(s) (> 30 jours)");
        }

        long unsyncedCount = countUnsynced();
        if (unsyncedCount > MAX_UNSYNCED_ROWS) {
            long overflow = unsyncedCount - MAX_UNSYNCED_ROWS;
            // Supprime les `overflow` lignes non-synced les plus anciennes (timestamp_ms croissant).
            int deletedOverflow = db.delete(
                TABLE,
                COL_ID + " IN ("
                    + "SELECT " + COL_ID + " FROM " + TABLE
                    + " WHERE " + COL_SYNCED + " = 0"
                    + " ORDER BY " + COL_TIMESTAMP_MS + " ASC"
                    + " LIMIT ?"
                    + ")",
                new String[]{String.valueOf(overflow)}
            );
            Log.w(
                TAG,
                "pruneOld: PURGE FORCÉE anti-saturation — " + deletedOverflow
                    + " position(s) NON synchronisée(s) supprimée(s) (plafond " + MAX_UNSYNCED_ROWS
                    + " dépassé, " + unsyncedCount + " lignes en attente). "
                    + "Le worker d'envoi (PositionUploadWorker) est probablement en panne "
                    + "prolongée — vérifier le token/la connectivité."
            );
        }
    }
}
