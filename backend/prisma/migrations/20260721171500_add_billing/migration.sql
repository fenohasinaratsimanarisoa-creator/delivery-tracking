-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('free', 'starter', 'pro', 'enterprise');
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled', 'past_due', 'incomplete', 'unpaid', 'trialing');
CREATE TYPE "BillingProvider" AS ENUM ('stripe', 'mvola', 'orange_money');
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'open', 'paid', 'uncollectible', 'void');
CREATE TYPE "UsageResource" AS ENUM ('delivery', 'vehicle', 'user');

-- CreateTable billing_plans
CREATE TABLE "billing_plans" (
    "id" UUID NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "interval" TEXT NOT NULL DEFAULT 'month',
    "max_vehicles" INTEGER NOT NULL DEFAULT 5,
    "max_deliveries_per_month" INTEGER NOT NULL DEFAULT 50,
    "max_users" INTEGER NOT NULL DEFAULT 3,
    "features" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_plans_tier_key" ON "billing_plans"("tier");

-- CreateTable subscriptions
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "stripe_subscription_id" TEXT,
    "stripe_customer_id" TEXT,
    "mobile_money_ref" TEXT,
    "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "canceled_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "subscriptions_company_id_key" ON "subscriptions"("company_id");
CREATE UNIQUE INDEX "subscriptions_stripe_subscription_id_key" ON "subscriptions"("stripe_subscription_id");
CREATE INDEX "subscriptions_company_id_idx" ON "subscriptions"("company_id");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable invoices
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "provider" "BillingProvider" NOT NULL DEFAULT 'stripe',
    "provider_invoice_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "pdf_url" TEXT,
    "pdf_data" BYTEA,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE UNIQUE INDEX "invoices_provider_invoice_id_key" ON "invoices"("provider_invoice_id");
CREATE INDEX "invoices_company_id_idx" ON "invoices"("company_id");
CREATE INDEX "invoices_subscription_id_idx" ON "invoices"("subscription_id");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable usage_records
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "resource" "UsageResource" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usage_records_company_id_period_start_resource_key" ON "usage_records"("company_id", "period_start", "resource");
CREATE INDEX "usage_records_company_id_period_start_idx" ON "usage_records"("company_id", "period_start");

ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
