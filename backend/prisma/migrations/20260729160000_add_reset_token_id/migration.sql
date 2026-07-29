-- Add reset_token_id column for O(1) password reset lookup (Finding #7)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_token_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_reset_token_id_key" ON "users" ("reset_token_id") WHERE "reset_token_id" IS NOT NULL;

-- Also ensure license_plate scoped uniqueness indices exist (Finding #12)
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_company_id_license_plate_key" ON "vehicles" ("company_id", "license_plate") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "drivers_company_id_license_number_key" ON "drivers" ("company_id", "license_number") WHERE "deleted_at" IS NULL;
