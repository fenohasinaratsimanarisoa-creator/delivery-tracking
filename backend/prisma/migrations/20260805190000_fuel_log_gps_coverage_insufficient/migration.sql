-- Signal explicite d'« impossibilité de vérifier » le kilométrage saisi par le GPS.
--
-- Contexte : crossCheckFuelLogWithGps() retournait silencieusement quand gpsKm <= 0
-- (aucun dailyFuelReport sur la période : GPS téléphone coupé, permission refusée,
-- traceur débranché, ou rapports jamais générés). Un plein dont le kilométrage est
-- totalement invérifiable devenait indistinguable d'un plein cohérent — faille de
-- fraude. On ajoute une paire de champs dédiée (sémantiquement distincte de
-- gpsAnomalyFlag) et un type de notification pour l'absenter de la vérification.

-- CreateEnum (nouveau type de notification, priorité medium)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'fuel_gps_coverage_missing';

-- AlterTable : paire de champs « couverture GPS insuffisante »
ALTER TABLE "fuel_logs"
  ADD COLUMN "gps_coverage_insufficient_flag" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gps_coverage_insufficient_reason" TEXT;
