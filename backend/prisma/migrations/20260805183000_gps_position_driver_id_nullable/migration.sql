-- GpsPosition.driverId devient NULLABLE.
--
-- Contexte : une position peut désormais être enregistrée même si AUCUN chauffeur
-- n'était assigné au véhicule au moment du fix GPS. Le driverId est résolu via
-- VehicleAssignmentHistory au timestamp de la position (assigned_at <= fix_time
-- AND (unassigned_at IS NULL OR unassigned_at >= fix_time)), pas via l'affectation
-- courante driver.vehicleId. Si aucune affectation ne couvre cet instant, la
-- position est quand même persistée avec driver_id = NULL (trace GPS jamais perdue).
-- Les positions null-driver restent exploitées pour les calculs par-véhicule, mais
-- sont exclues des calculs par-chauffeur.

ALTER TABLE "gps_positions"
  ALTER COLUMN "driver_id" DROP NOT NULL;
