-- Add vehicleId to DailyFuelReport for GPS cross-check per vehicle

-- Step 1: Add column as nullable initially
ALTER TABLE "daily_fuel_reports" ADD COLUMN "vehicle_id" UUID;

-- Step 2: Backfill from driver->vehicle relation
UPDATE "daily_fuel_reports" dfr
SET "vehicle_id" = d."vehicle_id"
FROM "drivers" d
WHERE dfr.driver_id = d.id AND d."vehicle_id" IS NOT NULL;

-- Step 3: For records with no driver->vehicle, try matching by vehicle_plate
UPDATE "daily_fuel_reports" dfr
SET "vehicle_id" = v.id
FROM "vehicles" v
WHERE dfr."vehicle_id" IS NULL
  AND v."license_plate" = dfr.vehicle_plate
  AND v."company_id" = dfr."company_id";

-- Step 4: Set NOT NULL (all reports should have a vehicle)
ALTER TABLE "daily_fuel_reports" ALTER COLUMN "vehicle_id" SET NOT NULL;

-- Step 5: Add foreign key constraint
ALTER TABLE "daily_fuel_reports" ADD CONSTRAINT "daily_fuel_reports_vehicle_id_fkey"
  FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE;

-- Step 6: Add index
CREATE INDEX IF NOT EXISTS "daily_fuel_reports_vehicle_id_idx" ON "daily_fuel_reports" ("vehicle_id");
