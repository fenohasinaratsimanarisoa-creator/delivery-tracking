-- Per-company editable default fuel prices (replaces the hard-coded fallback).
-- Values are editable in the app and persisted here.

ALTER TABLE "company_fuel_settings" ADD COLUMN "default_fuel_prices" JSONB;

-- Backfill existing companies with the legacy default prices so behavior is unchanged.
UPDATE "company_fuel_settings"
SET "default_fuel_prices" = '{"essence":5000,"gasoil":4900,"diesel":4900,"electric":0,"hybrid":3000}'::jsonb
WHERE "default_fuel_prices" IS NULL;
