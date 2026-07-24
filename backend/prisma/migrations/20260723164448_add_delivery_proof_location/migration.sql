-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'location_mismatch';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "delivery_proof_accuracy" DOUBLE PRECISION,
ADD COLUMN     "delivery_proof_distance" DOUBLE PRECISION,
ADD COLUMN     "delivery_proof_lat" DOUBLE PRECISION,
ADD COLUMN     "delivery_proof_lng" DOUBLE PRECISION,
ADD COLUMN     "location_mismatch" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mismatch_resolved" BOOLEAN NOT NULL DEFAULT false;
