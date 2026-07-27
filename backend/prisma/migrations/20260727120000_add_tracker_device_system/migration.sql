-- CreateEnum
CREATE TYPE "TrackerProtocol" AS ENUM ('GT06', 'TELTONIKA', 'TK103', 'H02', 'MEITRACK', 'QUECLINK', 'JIMI', 'COBAN', 'NAVTELECOM', 'SINOTRACK', 'RUPTELA', 'CALAMP', 'GALILEOSKY', 'TRACCAR_BRIDGE');

-- CreateTable: device_models
CREATE TABLE "device_models" (
    "id" UUID NOT NULL,
    "manufacturer" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "protocol" "TrackerProtocol" NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_models_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "device_models_manufacturer_model_name_key" UNIQUE ("manufacturer", "model_name")
);

-- CreateTable: tracker_devices
CREATE TABLE "tracker_devices" (
    "id" UUID NOT NULL,
    "imei" TEXT NOT NULL,
    "protocol" "TrackerProtocol" NOT NULL,
    "device_model_id" UUID,
    "vehicle_id" UUID,
    "company_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_position_at" TIMESTAMP(3),
    "firmware_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tracker_devices_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tracker_devices_imei_key" UNIQUE ("imei"),
    CONSTRAINT "tracker_devices_vehicle_id_key" UNIQUE ("vehicle_id")
);

-- CreateIndex
CREATE INDEX "tracker_devices_company_id_idx" ON "tracker_devices"("company_id");
CREATE INDEX "tracker_devices_protocol_idx" ON "tracker_devices"("protocol");

-- AddForeignKey: tracker_devices.device_model_id → device_models.id
ALTER TABLE "tracker_devices" ADD CONSTRAINT "tracker_devices_device_model_id_fkey" FOREIGN KEY ("device_model_id") REFERENCES "device_models"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: tracker_devices.vehicle_id → vehicles.id
ALTER TABLE "tracker_devices" ADD CONSTRAINT "tracker_devices_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: tracker_devices.company_id → companies.id
ALTER TABLE "tracker_devices" ADD CONSTRAINT "tracker_devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: device_commands
CREATE TABLE "device_commands" (
    "id" UUID NOT NULL,
    "tracker_id" UUID NOT NULL,
    "command" TEXT NOT NULL,
    "parameters" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error_msg" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_commands_tracker_id_status_idx" ON "device_commands"("tracker_id", "status");

-- AddForeignKey: device_commands.tracker_id → tracker_devices.id
ALTER TABLE "device_commands" ADD CONSTRAINT "device_commands_tracker_id_fkey" FOREIGN KEY ("tracker_id") REFERENCES "tracker_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
