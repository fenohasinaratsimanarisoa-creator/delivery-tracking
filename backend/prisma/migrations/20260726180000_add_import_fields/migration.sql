-- Add fields for Excel import feature
ALTER TABLE "deliveries" ADD COLUMN "client_phone" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "amount" INTEGER;
ALTER TABLE "deliveries" ADD COLUMN "article_price" INTEGER;
ALTER TABLE "deliveries" ADD COLUMN "product_description" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "external_order_ref" TEXT;
CREATE UNIQUE INDEX "deliveries_company_id_external_order_ref_key" ON "deliveries" ("company_id", "external_order_ref");
CREATE INDEX "deliveries_external_order_ref_idx" ON "deliveries" ("external_order_ref");
