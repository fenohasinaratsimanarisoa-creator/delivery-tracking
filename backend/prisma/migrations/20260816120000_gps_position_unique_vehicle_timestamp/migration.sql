-- GpsPosition : contrainte unique composite (vehicle_id, timestamp) — filet
-- anti-doublon de DERNIER recours au niveau base (voir schema.prisma).
--
-- Contexte : à la reconnexion du pont Traccar, le backfill (performBackfill,
-- fenêtre [dernière position → maintenant]) tourne en parallèle des positions
-- live (handlePosition) sur la MÊME fenêtre temporelle pour le MÊME device. La
-- course lecture→écriture est sérialisée PAR DEVICE en code (mutex en mémoire),
-- mais un environnement multi-réplica ou un redémarrage (clé Redis perdue)
-- laisserait une fenêtre de collision : la même position physique (même
-- timestamp Traccar) insérée deux fois avec deux id différents — pollution des
-- distances, rapports de trajet, carburant et alertes de proximité.
--
-- Cette contrainte remplace l'index NON unique gps_positions_vehicle_id_timestamp_idx
-- par un index UNIQUE : même arborescence B-tree, mêmes capacités pour les
-- requêtes par (vehicle_id, timestamp) (dédoublonnage, bornes de backfill).

-- 1) Déduplication des éventuels doublons DÉJÀ présents en base (production
--    avant ce correctif) : on conserve UNE SEULE ligne par (vehicle_id, timestamp),
--    la première insérée (ctid le plus faible). Sans cette purge préalable, la
--    création de l'index unique échouerait. No-op si aucun doublon n'existe.
DELETE FROM "gps_positions" a
USING "gps_positions" b
WHERE a."vehicle_id" = b."vehicle_id"
  AND a."timestamp" = b."timestamp"
  AND a.ctid > b.ctid;

-- 2) Remplacement de l'index non unique par l'index unique.
DROP INDEX IF EXISTS "gps_positions_vehicle_id_timestamp_idx";

CREATE UNIQUE INDEX "gps_positions_vehicle_id_timestamp_key"
  ON "gps_positions" ("vehicle_id", "timestamp");
