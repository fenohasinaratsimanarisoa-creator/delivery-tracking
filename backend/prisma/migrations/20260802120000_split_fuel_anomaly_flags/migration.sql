-- Split the single anomaly_flag/anomaly_reason into two independent detector pairs:
--   consumption_anomaly_flag/reason  <- fuel-analysis queue (processFuelLogAnalysis)
--   gps_anomaly_flag/reason          <- crossCheckFuelLogWithGps
--
-- The old columns are DROPPED. anomalyFlag/anomalyReason are no longer stored;
-- they are derived at the application layer (consumption OR gps) and exposed as
-- read-only fields in the response DTOs.

ALTER TABLE "fuel_logs"
  ADD COLUMN "consumption_anomaly_flag" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "consumption_anomaly_reason" TEXT,
  ADD COLUMN "gps_anomaly_flag" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gps_anomaly_reason" TEXT;

-- Backfill existing flags into the correct detector pair by reason content
-- (consumption messages start with "Consumption", GPS messages with "Distance").
UPDATE "fuel_logs" SET
  "consumption_anomaly_flag" = CASE
    WHEN "anomaly_flag" AND "anomaly_reason" LIKE 'Consumption%' THEN true ELSE false END,
  "consumption_anomaly_reason" = CASE
    WHEN "anomaly_flag" AND "anomaly_reason" LIKE 'Consumption%' THEN "anomaly_reason" ELSE NULL END,
  "gps_anomaly_flag" = CASE
    WHEN "anomaly_flag" AND ("anomaly_reason" IS NULL OR "anomaly_reason" LIKE 'Distance%') THEN true ELSE false END,
  "gps_anomaly_reason" = CASE
    WHEN "anomaly_flag" AND ("anomaly_reason" IS NULL OR "anomaly_reason" LIKE 'Distance%') THEN "anomaly_reason" ELSE NULL END
WHERE "anomaly_flag" = true;

ALTER TABLE "fuel_logs"
  DROP COLUMN "anomaly_flag",
  DROP COLUMN "anomaly_reason";
