-- Socle de données du module GPS↔carburant.
--
-- 1) Table d'historique d'affectation conducteur ↔ véhicule (append-only).
-- 2) Colonne `source` sur gps_positions pour connaître rétroactivement la source
--    d'émission de chaque position historique.
--
-- ---------------------------------------------------------------------------
-- INVARIANT de VehicleAssignmentHistory (voir aussi le commentaire dans
-- schema.prisma) : à un instant T donné, il existe au plus une ligne OUVERTE
-- (unassigned_at IS NULL) par vehicle_id, et au plus une ligne ouverte par
-- driver_id. Cette contrainte est appliquée de deux façons complémentaires :
--   a) en base, par les deux index uniques partiels ci-dessous (SQL brut —
--      Prisma ne sait pas représenter un index partiel dans le schéma, d'où
--      cette écriture manuelle, alignée sur le pattern déjà utilisé par
--      `20260729140000_scoped_uniqueness`) ;
--   b) en code applicatif : toute réaffectation s'effectue dans UNE transaction
--      Prisma qui ferme (unassigned_at = now()) la ligne ouverte concernée avant
--      d'en ouvrir une nouvelle (voir VehicleAssignmentHistoryService).
--
-- NOTE : la colonne `source` est NOT NULL SANS défaut final. Le défaut 'phone'
-- ci-dessous ne sert QU'AU backfill des lignes historiques : avant cette
-- migration, seule la positionSource du véhicule au moment de la requête faisait
-- foi — il n'existait aucune trace par position. On documente donc ce choix :
-- toutes les lignes pré-existantes sont supposées issues de l'app mobile
-- ('phone'), ce qui était la source historique par défaut. Le DEFAULT est ensuite
-- retiré : tout futur INSERT doit fournir `source` explicitement (le générateur
-- Prisma force alors TypeScript à l'exiger dans gpsPosition.create()/createMany()).

-- CreateEnum
CREATE TYPE "GpsPositionSource" AS ENUM ('phone', 'physical_tracker');

-- Backfill : NOT NULL + DEFAULT 'phone' (voir commentaire ci-dessus), puis
-- retrait du défaut silencieux.
ALTER TABLE "gps_positions"
  ADD COLUMN "source" "GpsPositionSource" NOT NULL DEFAULT 'phone';
ALTER TABLE "gps_positions"
  ALTER COLUMN "source" DROP DEFAULT;

-- CreateTable
CREATE TABLE "vehicle_assignment_history" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL,
    "unassigned_at" TIMESTAMP(3),

    CONSTRAINT "vehicle_assignment_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vehicle_assignment_history_vehicle_id_assigned_at_idx" ON "vehicle_assignment_history"("vehicle_id", "assigned_at");
CREATE INDEX "vehicle_assignment_history_driver_id_assigned_at_idx" ON "vehicle_assignment_history"("driver_id", "assigned_at");
CREATE INDEX "vehicle_assignment_history_company_id_idx" ON "vehicle_assignment_history"("company_id");

-- Invariant (a) : au plus une ligne OUVERTE par vehicle_id ET au plus une ligne
-- OUVERTE par driver_id.
CREATE UNIQUE INDEX "vehicle_assignment_history_one_open_per_vehicle"
  ON "vehicle_assignment_history"("vehicle_id") WHERE "unassigned_at" IS NULL;
CREATE UNIQUE INDEX "vehicle_assignment_history_one_open_per_driver"
  ON "vehicle_assignment_history"("driver_id") WHERE "unassigned_at" IS NULL;

-- AddForeignKey
ALTER TABLE "vehicle_assignment_history" ADD CONSTRAINT "vehicle_assignment_history_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_assignment_history" ADD CONSTRAINT "vehicle_assignment_history_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vehicle_assignment_history" ADD CONSTRAINT "vehicle_assignment_history_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
