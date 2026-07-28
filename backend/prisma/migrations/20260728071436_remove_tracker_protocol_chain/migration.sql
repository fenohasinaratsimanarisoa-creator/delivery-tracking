-- DropForeignKey (IF EXISTS pour idempotence)
ALTER TABLE "device_commands" DROP CONSTRAINT IF EXISTS "device_commands_tracker_id_fkey";

-- DropForeignKey (IF EXISTS pour idempotence)
ALTER TABLE "tracker_devices" DROP CONSTRAINT IF EXISTS "tracker_devices_company_id_fkey";

-- DropForeignKey (IF EXISTS pour idempotence)
ALTER TABLE "tracker_devices" DROP CONSTRAINT IF EXISTS "tracker_devices_device_model_id_fkey";

-- DropForeignKey (IF EXISTS pour idempotence)
ALTER TABLE "tracker_devices" DROP CONSTRAINT IF EXISTS "tracker_devices_vehicle_id_fkey";

-- DropForeignKey: FK vehicles → tracker_devices (manquante dans le schema Prisma mais existante en prod)
ALTER TABLE "vehicles" DROP CONSTRAINT IF EXISTS "vehicles_tracker_device_id_fkey";

-- DropTable (IF EXISTS pour idempotence)
DROP TABLE IF EXISTS "device_commands";

-- DropTable (IF EXISTS pour idempotence)
DROP TABLE IF EXISTS "device_models";

-- DropTable (IF EXISTS pour idempotence)
DROP TABLE IF EXISTS "tracker_devices";

-- DropEnum (IF EXISTS pour idempotence)
DROP TYPE IF EXISTS "TrackerProtocol";
