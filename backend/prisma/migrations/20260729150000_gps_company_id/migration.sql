-- Add company_id to gps_positions with backfill
ALTER TABLE "gps_positions" ADD COLUMN "company_id" uuid;
UPDATE "gps_positions" gp SET "company_id" = v.company_id FROM "vehicles" v WHERE gp.vehicle_id = v.id;
ALTER TABLE "gps_positions" ALTER COLUMN "company_id" SET NOT NULL;
CREATE INDEX IF NOT EXISTS "gps_positions_company_id_timestamp_idx" ON "gps_positions" ("company_id", "timestamp");

-- Add FK for daily_fuel_reports.company_id
ALTER TABLE "daily_fuel_reports" ADD CONSTRAINT "daily_fuel_reports_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;

-- Rename AuditLog.Company relation (no SQL change, just Prisma metadata)
