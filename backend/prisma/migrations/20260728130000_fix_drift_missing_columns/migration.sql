-- Cette migration ajoute toutes les colonnes et tables manquantes
-- qui étaient dans le schema Prisma mais jamais migrées en production

-- companies.pilot
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "pilot" BOOLEAN NOT NULL DEFAULT true;

-- gps_positions.delivery_id doit être nullable
ALTER TABLE "gps_positions" ALTER COLUMN "delivery_id" DROP NOT NULL;

-- geofence_events lat/lng doivent être nullable
ALTER TABLE "geofence_events" ALTER COLUMN "latitude" DROP NOT NULL;
ALTER TABLE "geofence_events" ALTER COLUMN "longitude" DROP NOT NULL;

-- daily_fuel_reports table
CREATE TABLE IF NOT EXISTS "daily_fuel_reports" (
    "id" UUID NOT NULL,
    "report_date" TIMESTAMP(3) NOT NULL,
    "driver_id" UUID NOT NULL,
    "driver_name" TEXT NOT NULL,
    "vehicle_plate" TEXT NOT NULL,
    "fuel_type" TEXT NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "consumption_l_per_100km" DOUBLE PRECISION,
    "estimated_cost" DOUBLE PRECISION NOT NULL,
    "price_per_liter_used" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,
    CONSTRAINT "daily_fuel_reports_pkey" PRIMARY KEY ("id")
);

-- fuel_price_history table
CREATE TABLE IF NOT EXISTS "fuel_price_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "fuel_type" TEXT NOT NULL,
    "price_per_liter" DOUBLE PRECISION NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fuel_price_history_pkey" PRIMARY KEY ("id")
);
