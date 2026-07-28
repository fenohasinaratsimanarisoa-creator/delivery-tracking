-- DropForeignKey
ALTER TABLE "device_commands" DROP CONSTRAINT "device_commands_tracker_id_fkey";

-- DropForeignKey
ALTER TABLE "tracker_devices" DROP CONSTRAINT "tracker_devices_company_id_fkey";

-- DropForeignKey
ALTER TABLE "tracker_devices" DROP CONSTRAINT "tracker_devices_device_model_id_fkey";

-- DropForeignKey
ALTER TABLE "tracker_devices" DROP CONSTRAINT "tracker_devices_vehicle_id_fkey";

-- DropTable
DROP TABLE "device_commands";

-- DropTable
DROP TABLE "device_models";

-- DropTable
DROP TABLE "tracker_devices";

-- DropEnum
DROP TYPE "TrackerProtocol";
