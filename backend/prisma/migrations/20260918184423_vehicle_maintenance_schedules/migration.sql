-- Seuils d'entretien préventif par véhicule (mvpromax.md §1.2). Table
-- entièrement nouvelle, aucune colonne existante touchée. S'appuie sur
-- maintenance_records (déjà en base, jamais utilisé jusqu'ici) pour la date du
-- dernier entretien effectué, et sur daily_fuel_reports (déjà en base) pour le
-- kilométrage parcouru depuis — aucune duplication de logique de distance.

CREATE TABLE "vehicle_maintenance_schedules" (
    "id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "interval_km" INTEGER,
    "interval_months" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,

    CONSTRAINT "vehicle_maintenance_schedules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vehicle_maintenance_schedules_company_id_idx" ON "vehicle_maintenance_schedules"("company_id");

CREATE INDEX "vehicle_maintenance_schedules_vehicle_id_idx" ON "vehicle_maintenance_schedules"("vehicle_id");

ALTER TABLE "vehicle_maintenance_schedules" ADD CONSTRAINT "vehicle_maintenance_schedules_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vehicle_maintenance_schedules" ADD CONSTRAINT "vehicle_maintenance_schedules_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
