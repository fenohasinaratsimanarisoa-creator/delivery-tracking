-- Qualité des données GPS du DailyFuelReport.
-- 'insufficient' : pas assez de positions (ou déplacement < 0.1 km) → le rapport
-- est créé avec distanceKm=0 au lieu d'être absent (évite les trous silencieux
-- dans le référentiel GPS utilisé par crossCheckFuelLogWithGps).
CREATE TYPE "GpsDataQuality" AS ENUM ('sufficient', 'insufficient');

ALTER TABLE "daily_fuel_reports"
  ADD COLUMN "gps_data_quality" "GpsDataQuality" NOT NULL DEFAULT 'sufficient';
