-- DailyFuelReport désormais par (driver_id, vehicle_id, report_date).
--
-- Contexte : un chauffeur qui change de véhicule en cours de journée produit des
-- positions GPS sur PLUSIEURS vehicle_id. Avant cette migration, @@unique(driver_id,
-- report_date) forçait un rapport unique par chauffeur/jour, attribuant TOUT le
-- kilométrage au véhicule courant du chauffeur (driver.vehicle) — y compris aux
-- positions enregistrées sur un autre véhicule. La contrainte est remplacée par
-- @@unique(driver_id, vehicle_id, report_date) : un rapport est créé PAR véhicule
-- réellement présent sur les positions du jour.
--
-- NOTE : la contrainte unique précédente (daily_fuel_reports_driver_id_report_date_key)
-- n'existe PAS dans la base (drift pré-existant entre le schéma et les migrations :
-- voir 20260729140000_scoped_uniqueness qui n'a pas créé cette contrainte sur cette
-- table). Rien à DROP ici ; on crée simplement la nouvelle contrainte + l'index
-- (vehicle_id, report_date) utilisé par crossCheckFuelLogWithGps() (agrégat par
-- vehicleId sur une plage de jours).

-- CreateIndex (contrainte d'unicité par (driver, vehicle, jour))
CREATE UNIQUE INDEX "daily_fuel_reports_driver_id_vehicle_id_report_date_key"
  ON "daily_fuel_reports"("driver_id", "vehicle_id", "report_date");

-- CreateIndex (agrégat du cross-check GPS par véhicule sur une plage de reportDate)
CREATE INDEX "daily_fuel_reports_vehicle_id_report_date_idx"
  ON "daily_fuel_reports"("vehicle_id", "report_date");

-- Nouveau seuil de tolérance configurable du cross-check GPS.
-- Défaut 1.3 (= 130%) : une distance saisie ne peut dépasser la distance GPS que de
-- 30% avant d'être signalée comme anomalie. L'ancien seuil en dur à 3 (= 300%)
-- laissait passer jusqu'à 2.9x de survalorisation invisible (voir
-- crossCheckFuelLogWithGps dans fuel-consumption.service.ts).
ALTER TABLE "company_fuel_settings"
  ADD COLUMN "cross_check_threshold" DOUBLE PRECISION DEFAULT 1.3;
