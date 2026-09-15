-- Système de paiement manuel (essai 14 jours + Simple/Pro/Business, 2026-09-15).
-- Module parallèle au système Stripe/MVola automatique (dormant, BILLING_ENABLED=false) :
-- réutilise BillingPlan/Subscription telles quelles, ajoute seulement les tables
-- nécessaires au flux manuel (preuve de paiement + moyens de paiement Mobile Money).

-- CreateEnum
CREATE TYPE "PaymentProofStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterEnum
ALTER TYPE "BillingProvider" ADD VALUE 'manual';

-- CreateTable
CREATE TABLE "platform_payment_methods" (
    "id" UUID NOT NULL,
    "provider" "BillingProvider" NOT NULL,
    "phone_number" TEXT NOT NULL,
    "holder_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_proofs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "submitted_by_id" UUID NOT NULL,
    "claimed_plan_id" UUID NOT NULL,
    "claimed_amount" INTEGER NOT NULL,
    "payment_method_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "proof_image" BYTEA NOT NULL,
    "proof_image_mime" TEXT NOT NULL,
    "status" "PaymentProofStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "activation_code_hash" TEXT,
    "activation_code_prefix" TEXT,
    "activation_expires_at" TIMESTAMP(3),
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_proofs_activation_code_hash_key" ON "payment_proofs"("activation_code_hash");

-- CreateIndex
CREATE INDEX "payment_proofs_company_id_idx" ON "payment_proofs"("company_id");

-- CreateIndex
CREATE INDEX "payment_proofs_status_idx" ON "payment_proofs"("status");

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_claimed_plan_id_fkey" FOREIGN KEY ("claimed_plan_id") REFERENCES "billing_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "platform_payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_proofs" ADD CONSTRAINT "payment_proofs_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "platform_admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Audit paiement manuel 2026-09-15 : une seule preuve "pending" à la fois par
-- société (même filet que invitations_pending_email_company_unique) — le
-- pré-check applicatif seul ne protège pas contre deux soumissions concurrentes.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_proofs_company_pending_unique"
  ON "payment_proofs"("company_id")
  WHERE "status" = 'pending';
