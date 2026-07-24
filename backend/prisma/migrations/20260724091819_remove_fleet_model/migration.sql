/*
  Warnings:

  - You are about to drop the column `fleet_id` on the `drivers` table. All the data in the column will be lost.
  - You are about to drop the column `fleet_id` on the `vehicles` table. All the data in the column will be lost.
  - You are about to drop the `fleets` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "drivers" DROP CONSTRAINT "drivers_fleet_id_fkey";

-- DropForeignKey
ALTER TABLE "fleets" DROP CONSTRAINT "fleets_company_id_fkey";

-- DropForeignKey
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_fleet_id_fkey";

-- AlterTable
ALTER TABLE "drivers" DROP COLUMN "fleet_id";

-- AlterTable
ALTER TABLE "vehicles" DROP COLUMN "fleet_id";

-- DropTable
DROP TABLE "fleets";
