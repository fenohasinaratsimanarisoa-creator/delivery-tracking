-- GpsPositionArchive.driver_id / delivery_id deviennent NULLABLES.
--
-- Contexte : gps_positions.driver_id est NULLABLE depuis
-- 20260805183000 (positions sans chauffeur assigné au timestamp, supportées),
-- et gps_positions.delivery_id l'est aussi (positions hors livraison). Le CTE
-- d'archivage (tracking.service.ts archivePositionsBefore /
-- archiveAllCompaniesPositionsBefore) copie ces colonnes dans
-- gps_positions_archive qui était NOT NULL : UNE seule position null suffisait
-- à faire échouer TOUTE la transaction (aucun archivage, table primaire qui
-- grossit sans borne, 500 sur POST /tracking/archive).
--
-- La table d'archivage n'a volontairement AUCUNE FK (données froides).

ALTER TABLE "gps_positions_archive"
  ALTER COLUMN "driver_id" DROP NOT NULL,
  ALTER COLUMN "delivery_id" DROP NOT NULL;