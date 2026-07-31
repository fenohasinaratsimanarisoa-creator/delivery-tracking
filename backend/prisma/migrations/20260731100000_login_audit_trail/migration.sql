-- Add login audit actions and allow audit entries for unknown users (failed logins)
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'login_success';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'login_failed';

ALTER TABLE "audit_logs" ALTER COLUMN "user_id" DROP NOT NULL;
ALTER TABLE "audit_logs" ALTER COLUMN "company_id" DROP NOT NULL;
