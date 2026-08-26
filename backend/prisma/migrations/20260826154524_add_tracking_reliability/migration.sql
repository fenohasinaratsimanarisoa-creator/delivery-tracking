-- CreateEnum
CREATE TYPE "TrackingReliability" AS ENUM ('reliable', 'battery_opt_not_ignored', 'background_perm_missing', 'oem_restricted');

-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "tracking_reliability" "TrackingReliability" NOT NULL DEFAULT 'reliable';
