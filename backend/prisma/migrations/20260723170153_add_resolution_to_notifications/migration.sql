-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "resolution_comment" TEXT,
ADD COLUMN     "resolved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolved_at" TIMESTAMP(3),
ADD COLUMN     "resolved_by_id" UUID;

-- CreateIndex
CREATE INDEX "notifications_company_id_resolved_created_at_idx" ON "notifications"("company_id", "resolved", "created_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
