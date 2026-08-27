-- AlterEnum
-- Audit carburant/GPS 2026-08-27 : signal "suspicious" pour un DailyFuelReport
-- dont la distance calculée montre les signes d'une dérive GPS stationnaire
-- (déplacement net minuscule vs distance cumulée, accuracy dégradée) plutôt
-- qu'un vrai trajet — voir upsertDailyReportForVehicleGroup, fuel-consumption.service.ts.
ALTER TYPE "GpsDataQuality" ADD VALUE 'suspicious';
