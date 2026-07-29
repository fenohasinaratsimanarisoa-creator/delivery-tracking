-- Scoped uniqueness: license_plate unique per company, license_number unique per company

-- Drop the old global unique constraints
ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "vehicles_license_plate_key";
ALTER TABLE "drivers" DROP CONSTRAINT IF EXISTS "drivers_license_number_key";

-- Add composite unique constraints scoped to company
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_company_id_license_plate_key" ON "vehicles" ("company_id", "license_plate") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "drivers_company_id_license_number_key" ON "drivers" ("company_id", "license_number") WHERE "deleted_at" IS NULL;
