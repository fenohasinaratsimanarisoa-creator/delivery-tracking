-- CreateIndex
-- Audit carburant 2026-08-27, HAUTE #5 : aucun index ne couvrait company_id,
-- alors que findAll()/findOne()/getConsumptionStats() filtrent TOUS par
-- companyId en premier — getConsumptionStats() en particulier fait un
-- findMany({where: {companyId}}) sans aucune limite ni filtre de date.
CREATE INDEX "fuel_logs_company_id_fill_date_idx" ON "fuel_logs"("company_id", "fill_date");
