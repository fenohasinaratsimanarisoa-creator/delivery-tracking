-- Score de conduite quotidien par chauffeur (mvpromax.md §1.3). Table
-- entièrement nouvelle, aucune colonne existante touchée. Le calcul (cron
-- nocturne) réutilise le regroupement (driverId, vehicleId, jour) déjà résolu
-- par daily_fuel_reports (distanceKm notamment) plutôt que de redupliquer la
-- logique d'attribution driver/véhicule de fuel-consumption.service.ts.

CREATE TABLE "driver_scores" (
    "id" UUID NOT NULL,
    "score_date" TIMESTAMP(3) NOT NULL,
    "score" INTEGER NOT NULL,
    "speeding_events" INTEGER NOT NULL DEFAULT 0,
    "harsh_events" INTEGER NOT NULL DEFAULT 0,
    "distance_km" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,

    CONSTRAINT "driver_scores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "driver_scores_driver_id_vehicle_id_score_date_key" ON "driver_scores"("driver_id", "vehicle_id", "score_date");

CREATE INDEX "driver_scores_company_id_score_date_idx" ON "driver_scores"("company_id", "score_date");

CREATE INDEX "driver_scores_driver_id_score_date_idx" ON "driver_scores"("driver_id", "score_date");

ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "driver_scores" ADD CONSTRAINT "driver_scores_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
