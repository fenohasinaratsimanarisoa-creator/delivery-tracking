-- Add position_source column (was missing from previous migrations)
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "position_source" TEXT NOT NULL DEFAULT 'phone';

-- Add traccar_device_id column (Prisma schema @map('traccar_device_id'))
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "traccar_device_id" TEXT;

-- Unique index on traccar_device_id (NULLs don't conflict in PostgreSQL)
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_traccar_device_id_key" ON "vehicles"("traccar_device_id");
