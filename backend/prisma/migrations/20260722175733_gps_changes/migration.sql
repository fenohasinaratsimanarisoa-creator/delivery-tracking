-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'speed_alert';
ALTER TYPE "NotificationType" ADD VALUE 'prolonged_stop';
ALTER TYPE "NotificationType" ADD VALUE 'delay_alert';
ALTER TYPE "NotificationType" ADD VALUE 'device_offline';
ALTER TYPE "NotificationType" ADD VALUE 'geofence_event';

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "offline_timeout_minutes" INTEGER DEFAULT 10,
ADD COLUMN     "prolonged_stop_minutes" INTEGER DEFAULT 15,
ADD COLUMN     "speed_alert_threshold" DOUBLE PRECISION DEFAULT 80;

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "public_tracking_revoked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "gps_positions" ADD COLUMN     "accuracy" DOUBLE PRECISION,
ADD COLUMN     "altitude" DOUBLE PRECISION,
ADD COLUMN     "heading" DOUBLE PRECISION,
ADD COLUMN     "suspect" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "delivery_id" UUID,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radius_meters" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofence_events" (
    "id" UUID NOT NULL,
    "geofence_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geofence_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gps_positions_archive" (
    "id" UUID NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "suspect" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "delivery_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gps_positions_archive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geofences_company_id_idx" ON "geofences"("company_id");

-- CreateIndex
CREATE INDEX "geofences_delivery_id_idx" ON "geofences"("delivery_id");

-- CreateIndex
CREATE INDEX "geofence_events_geofence_id_idx" ON "geofence_events"("geofence_id");

-- CreateIndex
CREATE INDEX "geofence_events_vehicle_id_idx" ON "geofence_events"("vehicle_id");

-- CreateIndex
CREATE INDEX "geofence_events_timestamp_idx" ON "geofence_events"("timestamp");

-- CreateIndex
CREATE INDEX "gps_positions_archive_timestamp_idx" ON "gps_positions_archive"("timestamp");

-- CreateIndex
CREATE INDEX "gps_positions_archive_vehicle_id_idx" ON "gps_positions_archive"("vehicle_id");

-- CreateIndex
CREATE INDEX "gps_positions_archive_delivery_id_idx" ON "gps_positions_archive"("delivery_id");

-- CreateIndex
CREATE INDEX "gps_positions_vehicle_id_timestamp_idx" ON "gps_positions"("vehicle_id", "timestamp");

-- CreateIndex
CREATE INDEX "gps_positions_delivery_id_timestamp_idx" ON "gps_positions"("delivery_id", "timestamp");

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_geofence_id_fkey" FOREIGN KEY ("geofence_id") REFERENCES "geofences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofence_events" ADD CONSTRAINT "geofence_events_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
