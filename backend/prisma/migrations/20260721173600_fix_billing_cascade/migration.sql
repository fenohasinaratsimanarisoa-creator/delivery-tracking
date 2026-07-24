-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_company_id_fkey";
ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "invoices_subscription_id_fkey";
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_company_id_fkey";

-- AddForeignKey with Cascade
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
